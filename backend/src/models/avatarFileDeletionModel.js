/**
 * The queue of single avatar files to remove from the cloud — migration 041:
 * the photo a moderator took down, the one the person cleared or replaced, the
 * registrant's photo of an account taken over. The folder of a deleted account
 * is the other queue (avatarDeletionModel.js, migration 040). What the loop does
 * with a task: services/avatarDeletionLoop.js.
 *
 * All times are the database's: columns are TIMESTAMPTZ, compared with NOW(), and
 * a pause goes in as milliseconds. No JS Date crosses this boundary.
 */

import { pool } from '../config/database.js';

/** Why a file goes — the CHECK of the table. */
export const AVATAR_FILE_REASONS = Object.freeze({
  MODERATOR_REMOVED: 'moderator_removed',
  CLEARED: 'cleared',
  REPLACED: 'replaced',
  TAKEN_OVER: 'taken_over',
});

/**
 * Whether the table is there — asked BEFORE the caller's transaction: inside it,
 * a missing table would poison the transaction, and the person's own change of
 * photo would answer 500 (the window between the deploy and the migration).
 *
 * @param {Object} [db=pool] - pool or a connected client
 * @returns {Promise<boolean>}
 */
export const avatarFileDeletionTableExists = async (db = pool) => {
  const result = await db.query(
    "SELECT to_regclass('public.avatar_file_deletions') IS NOT NULL AS present",
  );
  return result.rows[0]?.present === true;
};

/**
 * Add the task, inside the caller's transaction: the link goes and its file's
 * task comes in one write. Due at once — nothing is still to land in the file,
 * unlike a folder after a deletion. A file asked for again while its task is open
 * or done stays as it is; a given-up one comes back to the queue.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {Object} task
 * @param {string} task.publicId - the file, inside avatars/<userId>/ (checked by the caller)
 * @param {string} task.userId - whose folder
 * @param {string} task.reason - one of AVATAR_FILE_REASONS
 * @returns {Promise<void>}
 */
export const enqueueAvatarFileDeletion = async (client, { publicId, userId, reason }) => {
  await client.query(
    `INSERT INTO avatar_file_deletions (public_id, user_id, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (public_id) DO UPDATE
        SET status = 'pending', attempts = 0, next_attempt_at = NOW(),
            last_error = NULL, finished_at = NULL
      WHERE avatar_file_deletions.status = 'failed'`,
    [publicId, userId, reason],
  );
};

/**
 * Take the task due longest ago, as claimNextDue of the folder queue: one
 * statement moves its next attempt past the lease, so no other process takes it,
 * and if this one dies the task comes due again by itself.
 *
 * @param {number} leaseMs
 * @returns {Promise<{public_id: string, user_id: string, attempts: number}|null>}
 */
export const claimNextDueFile = async (leaseMs) => {
  const result = await pool.query(
    `UPDATE avatar_file_deletions
        SET next_attempt_at = NOW() + ($1::int * INTERVAL '1 millisecond')
      WHERE public_id = (
        SELECT public_id FROM avatar_file_deletions
         WHERE status = 'pending' AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at, public_id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING public_id, user_id, attempts`,
    [leaseMs],
  );
  return result.rows[0] ?? null;
};

/**
 * The file is gone (or was gone already): the task is closed; the row stays as
 * the record.
 *
 * @param {string} publicId
 * @returns {Promise<void>}
 */
export const markFileDone = async (publicId) => {
  await pool.query(
    `UPDATE avatar_file_deletions
        SET status = 'done', finished_at = NOW(), last_error = NULL
      WHERE public_id = $1`,
    [publicId],
  );
};

/**
 * An attempt failed: count it, keep what the cloud said, and either wait
 * `pauseMs` or, with a null pause, give the task up. A given-up row stays.
 *
 * @param {string} publicId
 * @param {Object} failure
 * @param {number} failure.attempts - attempts made, this one included
 * @param {string} failure.error - text for last_error
 * @param {number|null} failure.pauseMs - the pause, or null when none is left
 * @returns {Promise<void>}
 */
export const recordFileFailure = async (publicId, { attempts, error, pauseMs }) => {
  await pool.query(
    `UPDATE avatar_file_deletions
        SET attempts = $2,
            last_error = $3,
            status = CASE WHEN $4::int IS NULL THEN 'failed' ELSE 'pending' END,
            finished_at = CASE WHEN $4::int IS NULL THEN NOW() ELSE NULL END,
            next_attempt_at = CASE WHEN $4::int IS NULL THEN next_attempt_at
                                   ELSE NOW() + ($4::int * INTERVAL '1 millisecond') END
      WHERE public_id = $1`,
    [publicId, attempts, error, pauseMs],
  );
};

/**
 * How many file tasks are waiting and how many were given up — for the loop's
 * hourly line in the journal.
 *
 * @returns {Promise<{pending: number, failed: number}>}
 */
export const countOpenFiles = async () => {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM avatar_file_deletions`,
  );
  return result.rows[0];
};
