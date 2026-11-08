/**
 * The queue of avatar folders to empty after an account is deleted — migration
 * 040. What the loop does with a task: services/avatarDeletionLoop.js.
 *
 * All times are the database's: columns are TIMESTAMPTZ, compared with NOW(), and
 * a pause goes in as milliseconds. No JS Date crosses this boundary.
 */

import { FIRST_ATTEMPT_DELAY_MS } from '../config/avatarDeletion.js';
import { pool } from '../config/database.js';

/**
 * Whether the table is there — asked BEFORE a deletion's transaction: inside it,
 * a missing table would poison the transaction and the deletion would answer
 * 500 (the window between the deploy and the migration).
 *
 * @param {Object} [db=pool] - pool or a connected client
 * @returns {Promise<boolean>}
 */
export const avatarDeletionTableExists = async (db = pool) => {
  const result = await db.query(
    "SELECT to_regclass('public.avatar_deletions') IS NOT NULL AS present",
  );
  return result.rows[0]?.present === true;
};

/**
 * Add the task, inside the caller's transaction: the deletion and its task are
 * one write. First due after FIRST_ATTEMPT_DELAY_MS, so that an upload under way
 * has landed by then.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @returns {Promise<void>}
 */
export const enqueueAvatarDeletion = async (client, userId) => {
  await client.query(
    `INSERT INTO avatar_deletions (user_id, next_attempt_at)
     VALUES ($1, NOW() + ($2::int * INTERVAL '1 millisecond'))
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, FIRST_ATTEMPT_DELAY_MS],
  );
};

/**
 * Take the task due longest ago: one statement moves its next attempt past the
 * lease, so no other process takes it, and if this one dies the task simply
 * comes due again. A claim is not an attempt: a restart in the middle costs
 * nothing, and only a failure the cloud reported counts.
 *
 * @param {number} leaseMs
 * @returns {Promise<{user_id: string, attempts: number}|null>}
 */
export const claimNextDue = async (leaseMs) => {
  const result = await pool.query(
    `UPDATE avatar_deletions
        SET next_attempt_at = NOW() + ($1::int * INTERVAL '1 millisecond')
      WHERE user_id = (
        SELECT user_id FROM avatar_deletions
         WHERE status = 'pending' AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at, user_id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING user_id, attempts`,
    [leaseMs],
  );
  return result.rows[0] ?? null;
};

/**
 * The folder is empty: the task is closed. The row stays as the record, with the
 * number of files: `done` with zero is told apart from the job done.
 *
 * @param {string} userId
 * @param {number} filesDeleted - files this run destroyed
 * @returns {Promise<void>}
 */
export const markDone = async (userId, filesDeleted) => {
  await pool.query(
    `UPDATE avatar_deletions
        SET status = 'done', finished_at = NOW(), last_error = NULL, files_deleted = $2
      WHERE user_id = $1`,
    [userId, filesDeleted],
  );
};

/**
 * An attempt failed: count it, keep what the cloud said, and either wait
 * `pauseMs` or, with a null pause, give the task up. A given-up row stays.
 *
 * @param {string} userId
 * @param {Object} failure
 * @param {number} failure.attempts - attempts made, this one included
 * @param {string} failure.error - text for last_error
 * @param {number|null} failure.pauseMs - the pause, or null when none is left
 * @returns {Promise<void>}
 */
export const recordFailure = async (userId, { attempts, error, pauseMs }) => {
  await pool.query(
    `UPDATE avatar_deletions
        SET attempts = $2,
            last_error = $3,
            status = CASE WHEN $4::int IS NULL THEN 'failed' ELSE 'pending' END,
            finished_at = CASE WHEN $4::int IS NULL THEN NOW() ELSE NULL END,
            next_attempt_at = CASE WHEN $4::int IS NULL THEN next_attempt_at
                                   ELSE NOW() + ($4::int * INTERVAL '1 millisecond') END
      WHERE user_id = $1`,
    [userId, attempts, error, pauseMs],
  );
};

/**
 * How many tasks are waiting and how many were given up — for the loop's hourly
 * line in the journal.
 *
 * @returns {Promise<{pending: number, failed: number}>}
 */
export const countOpen = async () => {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM avatar_deletions`,
  );
  return result.rows[0];
};
