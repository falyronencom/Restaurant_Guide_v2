/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: utils/gracefulShutdown.js — the sequence server.js runs on a
 * signal or a crash, and the exit code it ends with.
 *
 * The code is the platform's only view of how the process ended. A deploy
 * (SIGTERM) must end with 0; a crash must end with a non-zero code even when
 * every step of the shutdown succeeds, or a restart-on-failure policy leaves
 * the service down. The crash cases go through installShutdownHandlers with
 * a stand-in process, so the routing from the event to the code is covered,
 * not only the function.
 *
 * Everything is a fake: the server's close() hands its callback to the test,
 * which plays the end of the HTTP drain when it chooses to.
 */

import { EventEmitter } from 'events';
import { jest } from '@jest/globals';
import {
  createGracefulShutdown,
  installShutdownHandlers,
  exitCodeFor,
  PLANNED_SHUTDOWN_REASONS,
} from '../../utils/gracefulShutdown.js';

const BUDGET_MS = 195000;

/** A promise the test resolves or rejects by hand. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Let every queued microtask (awaits inside the close callback) run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const buildShutdown = (overrides = {}) => {
  const closeCallbacks = [];
  const server = { close: jest.fn((callback) => closeCallbacks.push(callback)) };
  const timers = [];
  const deps = {
    getServer: () => server,
    backgroundLoops: [
      { stop: jest.fn(() => Promise.resolve()), failureMessage: 'OCR poller stop failed during shutdown' },
      { stop: jest.fn(() => Promise.resolve()), failureMessage: 'Refresh token pruner stop failed during shutdown' },
    ],
    closePool: jest.fn(() => Promise.resolve()),
    disconnectRedis: jest.fn(() => Promise.resolve()),
    timeoutMs: BUDGET_MS,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    exit: jest.fn(),
    setTimer: jest.fn((callback, ms) => timers.push({ callback, ms })),
    ...overrides,
  };
  const shutdown = createGracefulShutdown(deps);

  /** The HTTP drain is over: run the callback server.close() was given. */
  const finishDrain = async () => {
    expect(closeCallbacks).toHaveLength(1);
    closeCallbacks[0]();
    await flush();
  };

  return { shutdown, deps, server, timers, finishDrain };
};

describe('exit code by reason', () => {
  test('a deploy or Ctrl+C is planned (0); a crash or anything unknown is a failure (1)', () => {
    expect(PLANNED_SHUTDOWN_REASONS).toEqual(['SIGTERM', 'SIGINT']);
    expect(exitCodeFor('SIGTERM')).toBe(0);
    expect(exitCodeFor('SIGINT')).toBe(0);
    expect(exitCodeFor('UNCAUGHT_EXCEPTION')).toBe(1);
    expect(exitCodeFor('UNHANDLED_REJECTION')).toBe(1);
    expect(exitCodeFor('SIGHUP')).toBe(1);
    expect(exitCodeFor(undefined)).toBe(1);
  });
});

describe('createGracefulShutdown — a single shutdown', () => {
  test('SIGTERM (deploy): every step runs, in order, and the process exits with 0', async () => {
    const { shutdown, deps, finishDrain } = buildShutdown();

    await shutdown('SIGTERM');
    expect(deps.exit).not.toHaveBeenCalled();

    await finishDrain();

    expect(deps.closePool).toHaveBeenCalledTimes(1);
    expect(deps.disconnectRedis).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.logger.info).toHaveBeenCalledWith('Graceful shutdown completed successfully', { exitCode: 0 });
  });

  test('SIGINT (local Ctrl+C) also exits with 0', async () => {
    const { shutdown, deps, finishDrain } = buildShutdown();

    await shutdown('SIGINT');
    await finishDrain();

    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  test('the force-exit timer is armed with the budget at once, and when it fires the exit is 1', async () => {
    const { shutdown, deps, timers } = buildShutdown();

    await shutdown('SIGTERM');

    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(BUDGET_MS);

    // The drain never ends — the timer decides.
    timers[0].callback();
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.logger.error).toHaveBeenCalledWith('Graceful shutdown timeout, forcing exit', { budgetMs: BUDGET_MS });
  });

  test('background loops stop at once, in parallel with the drain; the pool closes only after both have stopped', async () => {
    const ocr = deferred();
    const pruner = deferred();
    const { shutdown, deps, finishDrain } = buildShutdown({
      backgroundLoops: [
        { stop: jest.fn(() => ocr.promise), failureMessage: 'ocr failed' },
        { stop: jest.fn(() => pruner.promise), failureMessage: 'pruner failed' },
      ],
    });

    await shutdown('SIGTERM');

    // Both stop() calls are made before the HTTP server has finished draining.
    expect(deps.backgroundLoops[0].stop).toHaveBeenCalledTimes(1);
    expect(deps.backgroundLoops[1].stop).toHaveBeenCalledTimes(1);

    await finishDrain();
    expect(deps.closePool).not.toHaveBeenCalled();

    ocr.resolve();
    await flush();
    expect(deps.closePool).not.toHaveBeenCalled();

    pruner.resolve();
    await flush();
    expect(deps.closePool).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  test('a loop whose stop() fails is logged under its own message and does not hold the exit', async () => {
    const { shutdown, deps, finishDrain } = buildShutdown({
      backgroundLoops: [
        { stop: jest.fn(() => Promise.reject(new Error('poller stuck'))), failureMessage: 'OCR poller stop failed during shutdown' },
        { stop: jest.fn(() => Promise.resolve()), failureMessage: 'Refresh token pruner stop failed during shutdown' },
      ],
    });

    await shutdown('SIGTERM');
    await finishDrain();

    expect(deps.logger.error).toHaveBeenCalledWith('OCR poller stop failed during shutdown', { error: 'poller stuck' });
    expect(deps.closePool).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  test('a step that throws (closing the pool) ends with 1 and skips the rest', async () => {
    const { shutdown, deps, finishDrain } = buildShutdown({
      closePool: jest.fn(() => Promise.reject(new Error('pool busy'))),
    });

    await shutdown('SIGTERM');
    await finishDrain();

    expect(deps.disconnectRedis).not.toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});

describe('createGracefulShutdown — a second reason while shutting down', () => {
  test('a crash during a SIGTERM drain: the sequence is not started again, and the exit becomes 1', async () => {
    const { shutdown, deps, server, timers, finishDrain } = buildShutdown();

    await shutdown('SIGTERM');
    await shutdown('UNCAUGHT_EXCEPTION');

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    expect(deps.backgroundLoops[0].stop).toHaveBeenCalledTimes(1);

    await finishDrain();

    expect(deps.closePool).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  test('a SIGTERM arriving during a crash shutdown does not turn the crash into 0', async () => {
    const { shutdown, deps, server, finishDrain } = buildShutdown();

    await shutdown('UNHANDLED_REJECTION');
    await shutdown('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);

    await finishDrain();

    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.logger.warn).toHaveBeenCalledWith('SIGTERM received while already shutting down', { exitCode: 1 });
  });
});

describe('installShutdownHandlers — from the process event to the exit code', () => {
  const wire = () => {
    const built = buildShutdown();
    const processRef = new EventEmitter();
    installShutdownHandlers({ processRef, gracefulShutdown: built.shutdown, logger: built.deps.logger });
    return { ...built, processRef };
  };

  test('SIGTERM → exit 0', async () => {
    const { processRef, deps, finishDrain } = wire();

    processRef.emit('SIGTERM');
    await flush();
    await finishDrain();

    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  test('uncaughtException → logged, the same graceful sequence runs, exit 1', async () => {
    const { processRef, deps, finishDrain } = wire();

    processRef.emit('uncaughtException', new Error('boom'));
    await flush();

    expect(deps.logger.error).toHaveBeenCalledWith('Uncaught exception', expect.objectContaining({ error: 'boom' }));

    await finishDrain();

    expect(deps.closePool).toHaveBeenCalledTimes(1);
    expect(deps.disconnectRedis).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  test('unhandledRejection → logged, exit 1', async () => {
    const { processRef, deps, finishDrain } = wire();

    processRef.emit('unhandledRejection', new Error('lost promise'), Promise.resolve());
    await flush();

    expect(deps.logger.error).toHaveBeenCalledWith('Unhandled promise rejection', expect.objectContaining({ reason: expect.any(Error) }));

    await finishDrain();

    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});
