/**
 * Refresh Token Pruner
 *
 * Background loop that deletes refresh_tokens rows whose expires_at is old
 * enough to be past the retention tail. What is deleted and what deliberately
 * is not — burned rows, orphaned successors — is in config/refreshTokenPrune.js;
 * this module is the mechanism.
 *
 * Two properties are load-bearing and neither is obvious from the SQL:
 *
 * 1. THE BATCH IS ORDERED OLDEST-FIRST, AND THAT IS WHAT KEEPS IT LEGAL.
 *    refresh_tokens.replaced_by is a self-referencing foreign key with NO
 *    ACTION: a burned predecessor points at its successor, so deleting a
 *    successor while its predecessor survives violates the constraint and
 *    throws away the whole statement. NO ACTION defers the check to the end of
 *    the statement, so deleting a whole chain at once is fine — but a LIMIT
 *    can cut a chain in half. Ordering by expires_at makes that cut harmless:
 *    a predecessor is created earlier than its successor and therefore expires
 *    earlier, so it is inside the same batch or an earlier one. Verified
 *    against a real database, 2026-09-10: unordered the batch raises
 *    refresh_tokens_replaced_by_fkey, ordered it does not.
 *
 *    The ordering argument rests on one assumption worth naming, because it is
 *    not a law: expires_at is `new Date()` plus thirty days on the PROCESS
 *    clock (authService.generateTokenPair), so it is monotonic across a chain
 *    only while that clock moves forward. An NTP step backwards between two
 *    rotations — or an exact tie, where the UUID tiebreak decides — can put a
 *    successor before its predecessor. A cutoff that then lands between the
 *    two picks the successor without the predecessor and the batch dies on the
 *    foreign key. That costs one statement: the failure is logged, the cycle
 *    ends, and the next tick succeeds as soon as the cutoff has passed both
 *    rows. Nothing is deleted wrongly — the constraint is what stops it — so
 *    the case is tolerated rather than designed against: closing it needs a
 *    "not referenced by a survivor" anti-join on an unindexed replaced_by,
 *    a full scan on every batch forever against a rare, self-healing stall.
 *
 * 2. THE CUTOFF IS A JS DATE, NOT SQL NOW(). expires_at holds the process's
 *    local wall clock; NOW() returns the database session's. They differ on
 *    this project. See buildPruneCutoff in config/refreshTokenPrune.js.
 *
 * Lifecycle:
 *   - start() prunes once immediately, then every intervalMs. The immediate
 *     run is not impatience: Railway redeploys can easily land more often than
 *     the interval, and a prune that only ever fires on a timer would then
 *     never fire at all.
 *   - stop() stops new batches and waits for the cycle in progress, so
 *     closePool() in server.js cannot cut a DELETE off mid-flight. The wait is
 *     bounded by one batch, not by the backlog — the cycle checks for a stop
 *     between batches, which matters because the shutdown budget on Railway is
 *     the drain period and its platform default is zero (config/shutdown.js).
 *
 * The pruner must NOT start in NODE_ENV=test — tests call pruneOnce() and
 * tick() directly to avoid timing dependencies.
 */

import { pool } from '../config/database.js';
import logger from '../utils/logger.js';
import {
  BATCH_SIZE,
  MAX_BATCHES_PER_TICK,
  buildPruneCutoff,
  resolveRefreshTokenPrunePolicy,
} from '../config/refreshTokenPrune.js';

/**
 * One batch. The subquery picks by `id`, not by `ctid`: a ctid is a physical
 * address and any concurrent UPDATE moves it. invalidateAllUserTokens fires
 * exactly such an UPDATE on a reuse alert, and a batch that picked ctids a
 * moment earlier would then delete fewer rows than it selected — which the
 * cycle below cannot tell apart from "nothing left to delete" and would read
 * as drained, parking the rest of the backlog until the next tick. `id` is the
 * primary key and does not move.
 *
 * ORDER BY carries created_at and id behind expires_at only to break ties;
 * expires_at alone is what satisfies the foreign key (see the module comment).
 * NULLs in created_at — the column is nullable — sort last and change nothing,
 * expires_at is NOT NULL.
 */
const DELETE_BATCH_SQL = `
  DELETE FROM refresh_tokens
  WHERE id IN (
    SELECT id
    FROM refresh_tokens
    WHERE expires_at < $1
    ORDER BY expires_at, created_at, id
    LIMIT $2
  )
`;

let intervalId = null;
let tickPromise = null;
let stopRequested = false;
let policy = null;

/**
 * The policy in force. start() sets it from the environment it was given;
 * resolved lazily here so a cycle driven directly — tests, diagnostics — is
 * not a null dereference, and so stop() does not have to leave a live module
 * in a state where the next tick() crashes.
 *
 * @returns {{ retentionDays: number, intervalMs: number, warnings: string[] }}
 */
const activePolicy = () => {
  if (policy === null) {
    policy = resolveRefreshTokenPrunePolicy(process.env);
  }
  return policy;
};

/**
 * Delete one batch of rows expired before the cutoff.
 *
 * Exported for tests and diagnostics; the pruner schedules it itself.
 *
 * @param {Date} cutoff - Rows with expires_at strictly before this go
 * @param {number} [limit=BATCH_SIZE] - Rows to delete at most
 * @returns {Promise<number>} Rows actually deleted
 */
export const pruneOnce = async (cutoff, limit = BATCH_SIZE) => {
  const result = await pool.query(DELETE_BATCH_SQL, [cutoff, limit]);
  return result.rowCount;
};

/**
 * One prune cycle: batches until the table is drained, the per-tick cap is
 * reached, or a stop is requested.
 *
 * A short batch means nothing matched the cutoff any more — that is the
 * drained signal, and it is why the common case costs exactly one statement.
 *
 * @returns {Promise<number>} Rows deleted in this cycle
 */
const runTick = async () => {
  // The flag governs the cycle in flight, so a new cycle clears it. Only
  // start() and a direct tick() can begin one — stop() clears the interval —
  // so this cannot race a shutdown; what it prevents is the opposite trap, a
  // pruner that has been stopped once and silently no-ops on every later tick.
  stopRequested = false;

  const { retentionDays } = activePolicy();
  const cutoff = buildPruneCutoff(retentionDays);
  let deleted = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
    // Checked before every batch, not just at the top: stop() may have been
    // requested while the previous DELETE was in flight, and a shutdown that
    // has already started must not open another statement on a pool that
    // closePool() is about to take away.
    if (stopRequested) {
      break;
    }

    let count;
    try {
      count = await pruneOnce(cutoff);
    } catch (error) {
      // Never rethrown into the interval: housekeeping that fails is a log
      // line, not a reason to take the process down.
      logger.error('Refresh token pruner: batch failed', {
        error: error.message,
        cutoff,
        deletedBeforeFailure: deleted,
      });
      break;
    }

    deleted += count;

    if (count < BATCH_SIZE) {
      break;
    }
  }

  // Unconditional, and that is the whole point: this line is the only proof
  // the loop is alive. Logging only on a deletion made a healthy idle tick and
  // a dead interval look identical — both silent — and on this project the
  // difference is invisible for another reason too: the backend service has no
  // Railway watch paths, so it redeploys on every commit to main and the
  // startup line arrives every hour or two whether the timer works or not.
  // Take the redeploys away (by setting a watch path) and a broken interval
  // would announce itself only as a growing table.
  //
  // info, not debug: LOG_LEVEL is a dashboard variable nobody guards, and a
  // heartbeat that a routine "quieten the logs" edit switches off silently is
  // the same failure it exists to catch. The volume argument does not bite —
  // the uptime monitor alone puts ~288 health lines a day in this stream, next
  // to which 24 ticks is noise-level.
  logger.info('Refresh token pruner: tick finished', {
    deleted,
    cutoff,
    retentionDays,
  });

  return deleted;
};

/**
 * Interval callback. Overlapping calls — the interval firing while the
 * previous cycle is still batching — join the running cycle instead of
 * starting a second one. Without the guard a slow cycle would have several
 * ticks deleting against the same cutoff at once, multiplying the statements
 * and the lock footprint for no extra rows.
 *
 * @returns {Promise<number>} The in-flight cycle's result
 */
const tick = () => {
  if (tickPromise) {
    return tickPromise;
  }
  tickPromise = runTick().finally(() => {
    tickPromise = null;
  });
  return tickPromise;
};

/**
 * Start the prune interval. Idempotent — calling start() twice has no effect.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env] - Environment the policy is read from
 * @returns {{ retentionDays: number, intervalMs: number, warnings: string[] }} The resolved policy
 */
export const start = ({ env = process.env } = {}) => {
  if (intervalId !== null) {
    logger.warn('Refresh token pruner already running — start() ignored');
    return policy;
  }

  policy = resolveRefreshTokenPrunePolicy(env);
  stopRequested = false;

  intervalId = setInterval(() => {
    tick().catch((error) => {
      logger.error('Refresh token pruner: tick error', { error: error.message });
    });
  }, policy.intervalMs);

  logger.info('Refresh token pruner started', {
    retentionDays: policy.retentionDays,
    intervalMs: policy.intervalMs,
  });

  tick().catch((error) => {
    logger.error('Refresh token pruner: initial tick error', { error: error.message });
  });

  return policy;
};

/**
 * Stop the pruner. Waits for the cycle in progress — bounded by one batch, not
 * by the backlog. Called during graceful shutdown.
 *
 * @returns {Promise<void>}
 */
export const stop = async () => {
  stopRequested = true;

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Refresh token pruner interval cleared');
  }

  if (tickPromise) {
    try {
      await tickPromise;
    } catch (_err) {
      // Errors already logged inside runTick()
    }
  }

  // Cleared so a later start() cannot silently inherit a policy from the
  // environment of the previous one. activePolicy() re-resolves on demand, so
  // a tick driven directly after a stop is still a prune, not a crash.
  policy = null;
};

/**
 * Introspection helper for tests and diagnostics.
 *
 * @returns {{ running: boolean, pruning: boolean }}
 */
export const status = () => ({
  running: intervalId !== null,
  pruning: tickPromise !== null,
});

export { tick };
