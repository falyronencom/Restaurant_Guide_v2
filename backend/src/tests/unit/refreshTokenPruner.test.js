/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: refreshTokenPruner.js + config/refreshTokenPrune.js
 *
 * The pool is mocked; these cover what the integration suite cannot see — the
 * shape of the loop rather than the shape of the SQL. Namely: that a cycle
 * batches until the table is drained, that the per-tick cap bounds it, that
 * two overlapping ticks are one cycle, that a stop is noticed BETWEEN batches
 * (the graceful-shutdown budget on Railway is the drain period, and its
 * platform default is zero), that a failing batch is a log line rather than a
 * thrown interval, and that the policy resolver falls back the way the other
 * two config resolvers do.
 *
 * What the real database proves instead — the self-referencing foreign key,
 * the batch ordering that satisfies it, the clock the cutoff is built on — is
 * in integration/refresh-token-prune.test.js.
 */

import { jest } from '@jest/globals';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const mockQuery = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  pool: { query: mockQuery },
  default: { query: mockQuery },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

const Pruner = await import('../../services/refreshTokenPruner.js');
const {
  BATCH_SIZE,
  MAX_BATCHES_PER_TICK,
  buildPruneCutoff,
  resolveRefreshTokenPrunePolicy,
} = await import('../../config/refreshTokenPrune.js');

/** A DELETE that removed `n` rows, in the shape node-pg returns. */
const deleted = (n) => ({ rowCount: n });

// resetMocks wipes implementations before every test — re-arm the default.
beforeEach(() => {
  mockQuery.mockResolvedValue(deleted(0));
});

// start() leaves an interval and module state behind; every test that starts
// the pruner must hand it back clean for the next one.
afterEach(async () => {
  await Pruner.stop();
  // Один тест подменяет таймеры; вернуть настоящие обязан он же, иначе
  // setImmediate в тесте про stop() ждал бы вечно.
  jest.useRealTimers();
});

describe('resolveRefreshTokenPrunePolicy', () => {
  test('falls back to the Coordinator defaults on an empty environment', () => {
    const policy = resolveRefreshTokenPrunePolicy({});

    // Literals, not the constants themselves: asserting DEFAULT_RETENTION_DAYS
    // against DEFAULT_RETENTION_DAYS moves with any edit to it and pins
    // nothing. 7 days is the Coordinator's decision of 2026-09-13 and an hour
    // is the cadence — changing either should have to come past this test.
    expect(policy.retentionDays).toBe(7);
    expect(policy.intervalMs).toBe(60 * 60 * 1000);
    expect(policy.warnings).toEqual([]);
  });

  test('accepts an explicit zero retention without treating it as unset', () => {
    // 0 is a meaningful setting — delete on expiry — and must survive the
    // "absent or empty" branch that falls back to the default.
    expect(resolveRefreshTokenPrunePolicy({ REFRESH_TOKEN_RETENTION_DAYS: '0' }))
      .toMatchObject({ retentionDays: 0, warnings: [] });
  });

  test('falls back with a warning when retention is not a non-negative integer', () => {
    const policy = resolveRefreshTokenPrunePolicy({ REFRESH_TOKEN_RETENTION_DAYS: '7d' });

    expect(policy.retentionDays).toBe(7);
    expect(policy.warnings).toHaveLength(1);
    expect(policy.warnings[0]).toContain('REFRESH_TOKEN_RETENTION_DAYS');
  });

  test('clamps a retention above the ceiling and says so', () => {
    const policy = resolveRefreshTokenPrunePolicy({ REFRESH_TOKEN_RETENTION_DAYS: '4000' });

    expect(policy.retentionDays).toBe(365);
    expect(policy.warnings).toHaveLength(1);
  });

  test('raises an interval below the floor and says so', () => {
    const policy = resolveRefreshTokenPrunePolicy({ REFRESH_TOKEN_PRUNE_INTERVAL_MS: '1000' });

    expect(policy.intervalMs).toBe(60 * 1000);
    expect(policy.warnings).toHaveLength(1);
  });
});

describe('buildPruneCutoff', () => {
  test('subtracts the retention from the clock it is given', () => {
    const now = Date.UTC(2026, 8, 13, 12, 0, 0);

    const cutoff = buildPruneCutoff(7, now);

    expect(cutoff.getTime()).toBe(now - 7 * 24 * 60 * 60 * 1000);
  });
});

describe('prune cycle', () => {
  test('keeps batching while batches come back full, and stops on a short one', async () => {
    mockQuery
      .mockResolvedValueOnce(deleted(BATCH_SIZE))
      .mockResolvedValueOnce(deleted(BATCH_SIZE))
      .mockResolvedValueOnce(deleted(3));

    expect(await Pruner.tick()).toBe(BATCH_SIZE * 2 + 3);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  test('stops at the per-tick cap when the table never drains', async () => {
    // A backlog larger than one cycle must not hold the cycle open: the tick
    // has to be able to finish inside the shutdown budget.
    mockQuery.mockResolvedValue(deleted(BATCH_SIZE));

    expect(await Pruner.tick()).toBe(BATCH_SIZE * MAX_BATCHES_PER_TICK);
    expect(mockQuery).toHaveBeenCalledTimes(MAX_BATCHES_PER_TICK);
  });

  test('reports a tick that deleted nothing, so an idle loop is not a silent one', async () => {
    // The heartbeat. Until 14.09 this line was conditional on a deletion, and
    // the guard here asserted the opposite — that an empty tick says nothing.
    // Both were wrong for the same reason: a healthy idle tick and an interval
    // that never fired produced identical logs, so the only observable proof
    // the loop runs was the startup line, which arrives on redeploys rather
    // than on ticks.
    expect(await Pruner.tick()).toBe(0);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Refresh token pruner: tick finished',
      expect.objectContaining({ deleted: 0 }),
    );
  });

  test('reports how many rows a tick actually removed', async () => {
    // The heartbeat carries the count, so the same line answers both "did it
    // run" and "did it find anything". Asserting only the message would leave
    // a hard-coded zero undetected.
    mockQuery.mockResolvedValueOnce(deleted(7));

    expect(await Pruner.tick()).toBe(7);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Refresh token pruner: tick finished',
      expect.objectContaining({ deleted: 7, retentionDays: expect.any(Number) }),
    );
  });

  test('a failing batch is logged, not thrown, and ends the cycle', async () => {
    mockQuery
      .mockResolvedValueOnce(deleted(BATCH_SIZE))
      .mockRejectedValueOnce(new Error('deadlock detected'));

    // Resolves rather than rejects: the interval callback must never see it.
    expect(await Pruner.tick()).toBe(BATCH_SIZE);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Refresh token pruner: batch failed',
      expect.objectContaining({ error: 'deadlock detected' }),
    );
  });

  test('two overlapping ticks are one cycle, not two', async () => {
    // The interval does not wait for an async callback. Without the guard a
    // slow cycle would have several ticks deleting against the same cutoff at
    // once — the same rows, multiplied statements and locks.
    let releaseFirstBatch;
    mockQuery.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirstBatch = () => resolve(deleted(BATCH_SIZE));
    }));
    mockQuery.mockResolvedValue(deleted(0));

    const first = Pruner.tick();
    const second = Pruner.tick();

    expect(Pruner.status().pruning).toBe(true);
    releaseFirstBatch();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    // Same promise, therefore same cycle: the two batches are the first
    // cycle's own, not one batch each.
    expect(firstResult).toBe(secondResult);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('lifecycle', () => {
  test('start() prunes immediately and reports the resolved policy', async () => {
    // The immediate run is the point: Railway redeploys can land more often
    // than the interval, and a timer-only prune would then never fire.
    const policy = Pruner.start({ env: { REFRESH_TOKEN_RETENTION_DAYS: '3' } });

    expect(policy.retentionDays).toBe(3);
    expect(Pruner.status().running).toBe(true);

    // Already open, before this test awaits anything: the batch belongs to
    // start() itself, not to a tick some later line drove. Asserting after a
    // tick() of our own would pass just as well with no immediate run at all.
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // And it prunes against the policy start() was given, not a default: the
    // cutoff is three days back, not seven.
    const [, params] = mockQuery.mock.calls[0];
    const cutoffDaysBack = (Date.now() - params[0].getTime()) / (24 * 60 * 60 * 1000);
    expect(cutoffDaysBack).toBeCloseTo(3, 2);

    await Pruner.tick();
  });

  test('start() twice is a warning, not a second interval', async () => {
    jest.useFakeTimers();
    Pruner.start({ env: {} });
    Pruner.start({ env: {} });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Refresh token pruner already running — start() ignored',
    );

    // The half the title actually turns on, and it needs the clock to show.
    // A guard that warned and then fell through would overwrite intervalId,
    // orphaning the first timer past any reach of stop() — and the warning
    // above would still be there. Counting queries does NOT show it either:
    // the second start()'s tick joins the cycle already in flight, so the
    // count is 1 whichever branch ran. What separates them is what happens
    // after stop(): nothing may fire again.
    await Pruner.stop();
    mockQuery.mockClear();

    jest.advanceTimersByTime(2 * 60 * 60 * 1000);
    await Promise.resolve();

    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('stop() waits for the batch in flight', async () => {
    let releaseBatch;
    let batchSettled = false;
    mockQuery.mockImplementationOnce(() => new Promise((resolve) => {
      releaseBatch = () => {
        batchSettled = true;
        resolve(deleted(0));
      };
    }));

    const cycle = Pruner.tick();

    let stopResolved = false;
    const stopped = Pruner.stop().then(() => { stopResolved = true; });

    // A full macrotask turn, which drains the microtask queue behind it: a
    // stop() that did not await the cycle would have resolved by now.
    // Racing it against a resolved promise instead proves nothing — that race
    // is won on scheduling order, whatever stop() does.
    await new Promise((resolve) => { setImmediate(resolve); });
    expect(stopResolved).toBe(false);
    expect(batchSettled).toBe(false);

    // closePool() runs after this await in server.js — if stop() resolved
    // first, the DELETE would be cut off mid-flight.
    releaseBatch();
    await stopped;
    expect(stopResolved).toBe(true);
    expect(batchSettled).toBe(true);
    await cycle;
  });

  test('a cycle already running opens no further batches once stop() is requested', async () => {
    // The wait in stop() is bounded by ONE batch, not by the backlog. Without
    // the check between batches a cycle mid-backlog would keep opening
    // statements for the whole per-tick cap while the platform is counting
    // down to SIGKILL.
    let releaseFirstBatch;
    mockQuery.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirstBatch = () => resolve(deleted(BATCH_SIZE));
    }));
    mockQuery.mockResolvedValue(deleted(BATCH_SIZE));

    const cycle = Pruner.tick();
    const stopped = Pruner.stop();
    releaseFirstBatch();
    await stopped;
    await cycle;

    // Exactly the one batch that was already open — a full batch normally
    // means "keep going", and here it must not.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
