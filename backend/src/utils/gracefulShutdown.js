/**
 * Graceful shutdown — the sequence server.js runs on a signal or a crash.
 *
 * Lives here rather than in server.js so that the exit code it ends with can
 * be tested: server.js is the entry point and never starts under
 * NODE_ENV=test. Every dependency is passed in; nothing here touches the
 * real process unless server.js hands it over.
 *
 * Order (Coordinator decision 2026-09-05, option «б» — align the windows):
 *   1. Arm the force-exit timer with the budget from config/shutdown.js. On
 *      Railway that is the drain period minus a margin, so the timer fires
 *      before the platform's SIGKILL, never after it.
 *   2. Stop the background loops at once, in parallel with server.close():
 *      neither needs the HTTP server, and stop() waits for the work in flight
 *      — the OCR job (up to ocrService.JOB_DURATION_BOUND_MS) and the prune
 *      batch (one statement) — so they must not queue behind a slow request
 *      that is still draining.
 *   3. Once the HTTP connections are gone and both loops have stopped, close
 *      the pool and Redis, then exit.
 * A job that outlives the budget dies with the process as a 'processing'
 * row; ocrJobPoller's stale sweep settles it about an hour later.
 *
 * Exit code (2026-10-07). The code is the only thing the platform learns
 * about how the process ended. A planned stop — SIGTERM from a deploy,
 * SIGINT locally — ends with 0. A shutdown that began with a crash
 * (uncaughtException, unhandledRejection) ends with 1 even when every step
 * of it succeeds: a crashed process reporting success is not restarted by a
 * restart-on-failure policy, and the service would stay down until the next
 * deploy. Any reason not known to be planned counts as a crash.
 *
 * Re-entry. The first call runs the sequence; a later one — a second signal,
 * a crash in the middle of a drain — does not start it again (a second
 * server.close() would hurry the pool shut under requests still in flight).
 * It only raises the exit code: a crash during a SIGTERM drain still ends
 * with 1, and a SIGTERM arriving during a crash shutdown does not turn the
 * crash into 0.
 */

/** Reasons that mean "we were asked to stop" — the only ones that exit 0. */
export const PLANNED_SHUTDOWN_REASONS = Object.freeze(['SIGTERM', 'SIGINT']);

export const EXIT_CODE_CLEAN = 0;
export const EXIT_CODE_FAILURE = 1;

/** Exit code a shutdown started for `reason` ends with when nothing else fails. */
export const exitCodeFor = (reason) => (
  PLANNED_SHUTDOWN_REASONS.includes(reason) ? EXIT_CODE_CLEAN : EXIT_CODE_FAILURE
);

/**
 * Build the shutdown function.
 *
 * @param {Object} deps
 * @param {() => {close: Function}} deps.getServer - The HTTP server, read when
 *   the shutdown starts (server.js assigns it after this module is wired).
 * @param {Array<{stop: () => Promise<void>, failureMessage: string}>} deps.backgroundLoops -
 *   Loops stopped in parallel with server.close(); a rejected stop() is logged
 *   with its failureMessage and does not block the rest.
 * @param {() => Promise<void>} deps.closePool
 * @param {() => Promise<void>} deps.disconnectRedis
 * @param {number} deps.timeoutMs - Force-exit budget (config/shutdown.js).
 * @param {Object} deps.logger
 * @param {(code: number) => void} [deps.exit] - process.exit by default.
 * @param {Function} [deps.setTimer] - setTimeout by default.
 * @returns {(reason: string) => Promise<void>}
 */
export const createGracefulShutdown = ({
  getServer,
  backgroundLoops,
  closePool,
  disconnectRedis,
  timeoutMs,
  logger,
  exit = (code) => process.exit(code),
  setTimer = setTimeout,
}) => {
  // null until the first call; then the code the process will end with.
  let pendingExitCode = null;

  return async (reason) => {
    if (pendingExitCode !== null) {
      pendingExitCode = Math.max(pendingExitCode, exitCodeFor(reason));
      logger.warn(`${reason} received while already shutting down`, {
        exitCode: pendingExitCode,
      });
      return;
    }
    pendingExitCode = exitCodeFor(reason);

    logger.info(`${reason} received, starting graceful shutdown`, {
      budgetMs: timeoutMs,
      exitCode: pendingExitCode,
    });

    // Force exit if graceful shutdown outlives the budget
    setTimer(() => {
      logger.error('Graceful shutdown timeout, forcing exit', {
        budgetMs: timeoutMs,
      });
      exit(EXIT_CODE_FAILURE);
    }, timeoutMs);

    // Stop the background loops now — each stop() waits for its work in
    // flight. Errors are logged inside stop(); this catch only keeps the
    // await below safe.
    const loopsStopped = backgroundLoops.map(({ stop, failureMessage }) => stop().catch((error) => {
      logger.error(failureMessage, { error: error.message });
    }));

    // Stop accepting new connections
    getServer().close(async () => {
      logger.info('HTTP server closed, closing external connections');

      try {
        // Both background loops must be idle before the pool goes away
        await Promise.all(loopsStopped);

        // Close database connection pool
        await closePool();

        // Disconnect from Redis
        await disconnectRedis();

        logger.info('Graceful shutdown completed successfully', {
          exitCode: pendingExitCode,
        });
        exit(pendingExitCode);
      } catch (error) {
        logger.error('Error during graceful shutdown', {
          error: error.message,
          stack: error.stack,
        });
        exit(EXIT_CODE_FAILURE);
      }
    });
  };
};

/**
 * Route the process's stop signals and crash events into the shutdown.
 * Takes the process as a parameter so the routing itself is testable.
 *
 * @param {Object} params
 * @param {import('events').EventEmitter} params.processRef - process in server.js.
 * @param {(reason: string) => Promise<void>} params.gracefulShutdown
 * @param {Object} params.logger
 */
export const installShutdownHandlers = ({ processRef, gracefulShutdown, logger }) => {
  processRef.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  processRef.on('SIGINT', () => gracefulShutdown('SIGINT'));

  processRef.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });

  processRef.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', {
      reason,
      promise,
    });
    gracefulShutdown('UNHANDLED_REJECTION');
  });
};
