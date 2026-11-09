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
 * Single files (migration 041, models/avatarFileDeletionModel.js): the photo a
 * moderator took down, the one a person cleared or replaced, the registrant's
 * photo of an account taken over. After its folder task a tick removes up to
 * FILE_TASKS_PER_TICK of them — one destroy each, with the CDN's copies, and
 * the same pauses, claims and giving up as a folder. Without that table (the
 * window before 041) the files part says one line at info level per process and
 * does nothing; the folders go on.
 *
 * Whether it runs at all: config/avatarDeletion.js. It must not start under
 * NODE_ENV=test: tests call tick() directly, with the cloud stubbed.
 */

import { deleteAvatarFile, deleteAvatarFolder, ownCloudPublicId } from '../config/cloudinary.js';
import {
  CLAIM_LEASE_MS,
  FILE_TASKS_PER_TICK,
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
import {
  avatarFileDeletionTableExists,
  AVATAR_FILE_REASONS,
  claimNextDueFile,
  countOpenFiles,
  currentAvatarUrl,
  markFileDone,
  recordFileFailure,
} from '../models/avatarFileDeletionModel.js';
import logger from '../utils/logger.js';

const LAST_ERROR_MAX_LENGTH = 300;

let intervalId = null;
let tickPromise = null;
let stopRequested = false;
let lastHeartbeatAt = null;
let lastFileHeartbeatAt = null;
let saidTableAbsent = false;
let saidFileTableAbsent = false;

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
 * The hourly line of the files part — on its own clock and under its own name,
 * so that the folder line keeps its meaning.
 */
const fileHeartbeat = async () => {
  if (lastFileHeartbeatAt !== null && Date.now() - lastFileHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  lastFileHeartbeatAt = Date.now();
  const counts = await countOpenFiles();
  if (counts.failed > 0) {
    logger.error('Avatar file deletion: loop alive, tasks given up', counts);
  } else {
    logger.info('Avatar file deletion: loop alive', counts);
  }
};

/**
 * Count the failed attempt of a file: wait for the next pause, or give up.
 *
 * @param {{public_id: string, user_id: string, attempts: number}} task
 * @param {Error|string} error
 * @returns {Promise<void>}
 */
const settleFileFailure = async (task, error) => {
  const attempts = task.attempts + 1;
  const pauseMs = RETRY_PAUSES_MS[attempts - 1] ?? null;
  const text = failureText(error);

  await recordFileFailure(task.public_id, { attempts, error: text, pauseMs });

  if (pauseMs === null) {
    logger.error('Avatar file deletion: attempts ran out, the file stays on the cloud', {
      userId: task.user_id,
      attempts,
      error: text,
    });
    return;
  }
  logger.warn('Avatar file deletion: attempt failed, will try again', {
    userId: task.user_id,
    attempts,
    pauseMs,
    error: text,
  });
};

/**
 * Up to FILE_TASKS_PER_TICK single files. The file is destroyed only inside its
 * owner's avatar folder (deleteImage refuses the rest), with the CDN's copies.
 * A refusal is not a cloud failure and will not change by waiting: the task is
 * given up at once, with its line.
 *
 * @returns {Promise<void>}
 */
const runFileTasks = async () => {
  for (let done = 0; done < FILE_TASKS_PER_TICK; done += 1) {
    if (stopRequested) return;
    const task = await claimNextDueFile(CLAIM_LEASE_MS);
    if (!task) return;

    // A file the person let go of and then took back as their photo stays:
    // the task closes without a call to the cloud. A photo a moderator took
    // down goes whatever the person did since.
    if (task.reason !== AVATAR_FILE_REASONS.MODERATOR_REMOVED
      && ownCloudPublicId(await currentAvatarUrl(task.user_id)) === task.public_id) {
      await markFileDone(task.public_id);
      logger.info('Avatar file deletion: kept, the person uses the file again', { userId: task.user_id });
      continue;
    }

    let result;
    try {
      ({ result } = await deleteAvatarFile(task.public_id, task.user_id));
    } catch (error) {
      await settleFileFailure(task, error);
      continue;
    }

    if (result === 'ok' || result === 'not found') {
      await markFileDone(task.public_id);
      logger.info('Avatar file deletion: file removed', { userId: task.user_id, result });
    } else if (result === 'refused') {
      await recordFileFailure(task.public_id, {
        attempts: task.attempts + 1, error: "refused: not in the owner's avatar folder", pauseMs: null,
      });
      logger.error("Avatar file deletion: refused, the file is not in the owner's folder", { userId: task.user_id });
    } else {
      await settleFileFailure(task, `the cloud answered ${result}`);
    }
  }
};

/**
 * The folder part: at most one deleted account's folder.
 *
 * @returns {Promise<void>}
 */
const runFolderTask = async () => {
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
};

/**
 * One tick: at most one folder, then up to FILE_TASKS_PER_TICK files. Never
 * rejects. Each part is on whenever its table is there.
 *
 * @returns {Promise<void>}
 */
const runTick = async () => {
  stopRequested = false;
  try {
    if (await avatarDeletionTableExists()) {
      await runFolderTask();
    } else if (!saidTableAbsent) {
      saidTableAbsent = true;
      logger.info('Avatar deletion: no table yet (migration 040), nothing to do');
    }

    if (stopRequested) return;
    if (await avatarFileDeletionTableExists()) {
      await fileHeartbeat();
      await runFileTasks();
    } else if (!saidFileTableAbsent) {
      saidFileTableAbsent = true;
      logger.info('Avatar file deletion: no table yet (migration 041), nothing to do');
    }
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
  lastFileHeartbeatAt = null;
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
