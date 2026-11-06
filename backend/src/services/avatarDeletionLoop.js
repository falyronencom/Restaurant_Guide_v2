/**
 * Empties the avatar folder of every deleted account — the durable retry the
 * Coordinator chose on 05.11.2026 (thread «Хвосты записи», decision log
 * CAT-D-3.1). The deletion writes a task in its own transaction
 * (accountDeletionService.anonymiseAccount; the operator's script gets the same),
 * and this loop works through the tasks until the cloud has let the files go.
 *
 * Why the task survives anything:
 *   - a failure the cloud reports: the attempt is counted and the task waits for
 *     its pause (config/avatarDeletion.js, RETRY_PAUSES_MS);
 *   - a restart at any moment: all state is in the table. A claim only moves the
 *     task's next attempt forward (models/avatarDeletionModel.js, claimNextDue),
 *     so a process that dies leaves a task that comes due again by itself;
 *   - the attempts running out: the row stays as `failed`, with what the cloud
 *     said and a line at error level in the journal. Nothing goes away silently.
 *
 * Lifecycle, modelled on refreshTokenPruner.js:
 *   - start() runs once at once, then every minute: Railway redeploys can land
 *     often, and the immediate run costs nothing when the queue is empty;
 *   - stop() stops new work and waits for the task in progress. The wait is one
 *     call to the cloud at most, bounded by its deadline (deleteAvatarFolder, 20 s),
 *     plus one write to the database — inside the shutdown budget, which is 195 s
 *     on production and 30 s without the drain variable (config/shutdown.js). A
 *     task cut short this way needs no marking: it comes due when its claim ends;
 *   - without the table (the window before migration 040) a tick does nothing and
 *     says one line at info level per process: the deploy's journal shows it, and
 *     nothing else would.
 *
 * Whether it runs at all: config/avatarDeletion.js. It must not start under
 * NODE_ENV=test: tests call tick() directly, with the cloud stubbed.
 */

import { deleteAvatarFolder } from '../config/cloudinary.js';
import {
  CLAIM_LEASE_MS,
  HEARTBEAT_INTERVAL_MS,
  RETRY_PAUSES_MS,
  resolveAvatarDeletionPolicy,
} from '../config/avatarDeletion.js';
import {
  avatarDeletionTableExists,
  claimNextDue,
  countOpen,
  markDone,
  recordFailure,
} from '../models/avatarDeletionModel.js';
import logger from '../utils/logger.js';

const LAST_ERROR_MAX_LENGTH = 300;

let intervalId = null;
let tickPromise = null;
let stopRequested = false;
let lastHeartbeatAt = null;
let saidTableAbsent = false;

/**
 * What goes into the table and the journal from a failure.
 *
 * @param {Error} error
 * @returns {string}
 */
const failureText = (error) => String(error?.message ?? error).slice(0, LAST_ERROR_MAX_LENGTH);

/**
 * Count the failed attempt: wait for the next pause, or give up.
 *
 * @param {{user_id: string, attempts: number}} task
 * @param {Error} error
 * @returns {Promise<void>}
 */
const settleFailure = async (task, error) => {
  const attempts = task.attempts + 1;
  const pauseMs = RETRY_PAUSES_MS[attempts - 1] ?? null;
  const text = failureText(error);

  await recordFailure(task.user_id, { attempts, error: text, pauseMs });

  if (pauseMs === null) {
    logger.error('Avatar deletion: attempts ran out, the files stay on the cloud', {
      userId: task.user_id,
      attempts,
      error: text,
    });
    return;
  }
  logger.warn('Avatar deletion: attempt failed, will try again', {
    userId: task.user_id,
    attempts,
    pauseMs,
    error: text,
  });
};

/**
 * The one proof the loop is alive, once an hour: a silent minute says nothing. With
 * given-up tasks the line goes at error level: the single line of giving up leaves
 * the journal in days, and the files stay until someone returns the rows.
 */
const heartbeat = async () => {
  if (lastHeartbeatAt !== null && Date.now() - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatAt = Date.now();
  const counts = await countOpen();
  if (counts.failed > 0) {
    logger.error('Avatar deletion: loop alive, tasks given up', counts);
  } else {
    logger.info('Avatar deletion: loop alive', counts);
  }
};

/**
 * One tick: at most one task. Never rejects.
 *
 * @returns {Promise<void>}
 */
const runTick = async () => {
  stopRequested = false;
  try {
    if (!(await avatarDeletionTableExists())) {
      if (!saidTableAbsent) {
        saidTableAbsent = true;
        logger.info('Avatar deletion: no table yet (migration 040), nothing to do');
      }
      return;
    }
    await heartbeat();

    const task = await claimNextDue(CLAIM_LEASE_MS);
    if (!task) return;

    let outcome;
    try {
      outcome = await deleteAvatarFolder(task.user_id, { shouldStop: () => stopRequested });
    } catch (error) {
      await settleFailure(task, error);
      return;
    }

    // Stopped between two calls to the cloud: not a failure, nothing to write.
    // The claim brings the task back; what is already deleted stays deleted.
    if (!outcome.complete) {
      logger.info('Avatar deletion: stopped in the middle, the task comes back', { userId: task.user_id });
      return;
    }

    await markDone(task.user_id, outcome.deleted);
    logger.info('Avatar deletion: folder emptied', { userId: task.user_id, files: outcome.deleted });
  } catch (error) {
    // The database, not the cloud. A claimed task comes back by itself.
    logger.error('Avatar deletion: tick failed', { error: failureText(error) });
  }
};

/**
 * Interval callback. A call during a running tick joins it: one task at a time
 * is what keeps the loop inside the rate limit.
 *
 * @returns {Promise<void>}
 */
export const tick = () => {
  if (tickPromise) return tickPromise;
  tickPromise = runTick().finally(() => {
    tickPromise = null;
  });
  return tickPromise;
};

/**
 * Start the loop, if the policy says so. Idempotent.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @returns {{ enabled: boolean, intervalMs: number, warnings: string[] }} The policy
 */
export const start = ({ env = process.env } = {}) => {
  const policy = resolveAvatarDeletionPolicy(env);
  if (intervalId !== null) {
    logger.warn('Avatar deletion loop already running — start() ignored');
    return policy;
  }
  if (!policy.enabled) return policy;

  stopRequested = false;
  lastHeartbeatAt = null;
  intervalId = setInterval(() => {
    tick().catch((error) => {
      logger.error('Avatar deletion: tick error', { error: failureText(error) });
    });
  }, policy.intervalMs);

  tick().catch((error) => {
    logger.error('Avatar deletion: first tick error', { error: failureText(error) });
  });
  return policy;
};

/**
 * Stop the loop and wait for the task in progress — see the module comment for
 * how long that is. Called during graceful shutdown.
 *
 * @returns {Promise<void>}
 */
export const stop = async () => {
  stopRequested = true;
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (tickPromise) await tickPromise;
};

/**
 * For tests and diagnostics.
 *
 * @returns {{ running: boolean, working: boolean }}
 */
export const status = () => ({
  running: intervalId !== null,
  working: tickPromise !== null,
});
