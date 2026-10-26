/**
 * Email Verification Model
 *
 * Database access for email_verification_codes table (migration 026).
 * Manages 6-digit codes sent to users for email verification.
 *
 * Lifecycle: createCode (registration) or reserveCodeWithinLimit → the email
 * went out: activateReservedCode / did not: deleteReservedCode (resend) →
 * findActiveCodeForUser → markAsUsed (or expire).
 * Anti-bruteforce: incrementAttempts increments per failed verification;
 * service layer enforces max 5 attempts before invalidating the code.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Insert a new verification code for a user.
 *
 * @param {string} userId
 * @param {string} code - 6-digit numeric string
 * @param {Date} expiresAt
 * @returns {Promise<Object>} Created row
 */
export const createCode = async (userId, code, expiresAt) => {
  const query = `
    INSERT INTO email_verification_codes (user_id, code, expires_at)
    VALUES ($1, $2, $3)
    RETURNING id, user_id, code, expires_at, created_at, used_at, attempts
  `;

  try {
    const result = await pool.query(query, [userId, code, expiresAt]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating email verification code', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Find the latest active verification code for a user.
 * Active = not used AND not expired.
 *
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export const findActiveCodeForUser = async (userId) => {
  const query = `
    SELECT id, user_id, code, expires_at, created_at, used_at, attempts
    FROM email_verification_codes
    WHERE user_id = $1
      AND used_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    logger.error('Error finding active email verification code', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Count codes created within the last N minutes for rate limiting.
 *
 * @param {string} userId
 * @param {number} minutes
 * @returns {Promise<number>}
 */
export const countRecentSends = async (userId, minutes) => {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM email_verification_codes
    WHERE user_id = $1
      AND created_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
  `;

  try {
    const result = await pool.query(query, [userId, String(minutes)]);
    return result.rows[0].count;
  } catch (error) {
    logger.error('Error counting recent verification sends', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Invalidate all active codes for a user (called before writing the first
 * code at registration, so only the latest code is valid; a resend retires
 * them through activateReservedCode, once its email has gone out).
 *
 * @param {string} userId
 * @returns {Promise<number>} Rows affected
 */
export const invalidateActiveCodesForUser = async (userId) => {
  const query = `
    UPDATE email_verification_codes
    SET used_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND used_at IS NULL
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error invalidating active codes for user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Take the account's code lock for the rest of the transaction on `client`.
 * Resends of one account pass through the locked steps one at a time; other
 * accounts are not held (an advisory lock — no row is locked, nothing else
 * that writes these tables or `users` waits on it).
 *
 * @param {import('pg').PoolClient} client - Inside BEGIN
 * @param {string} userId
 */
const lockAccountCodes = (client, userId) =>
  client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`email_verification_codes:${userId}`]);

/**
 * Write a resend's code as a reservation, if the account is under its limit —
 * the check and the write under the account's lock, so resends that arrive
 * together are counted one after another and the limit holds (Н45). Until
 * 25.10 the count was read, the email awaited and the code written after it:
 * every resend in flight saw the same count.
 *
 * The reservation is born retired (used_at set): it counts toward the limit
 * while its email is on the way, but no one can verify with it, and the codes
 * the user already holds keep working. activateReservedCode makes it the
 * user's code once the email has gone out; deleteReservedCode removes it when
 * the email did not go out, so a resend that reached no one does not count.
 *
 * @param {string} userId
 * @param {string} code - 6-digit numeric string
 * @param {Date} expiresAt
 * @param {Object} limit
 * @param {number} limit.max - Codes allowed within the window
 * @param {number} limit.minutes - The window
 * @returns {Promise<{reserved: Object|null, recentCount: number}>} reserved is
 *   null when the limit is reached; recentCount — codes in the window before this one
 */
export const reserveCodeWithinLimit = async (userId, code, expiresAt, { max, minutes }) => {
  const countQuery = `
    SELECT COUNT(*)::int AS count
    FROM email_verification_codes
    WHERE user_id = $1
      AND created_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
  `;
  const reserveQuery = `
    INSERT INTO email_verification_codes (user_id, code, expires_at, used_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    RETURNING id, user_id, code, expires_at, created_at, used_at, attempts
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAccountCodes(client, userId);
    // A statement of its own, after the lock: under READ COMMITTED it sees
    // every reservation committed by the resends that held the lock before.
    const recentCount = (await client.query(countQuery, [userId, String(minutes)])).rows[0].count;
    if (recentCount >= max) {
      await client.query('ROLLBACK');
      return { reserved: null, recentCount };
    }
    const result = await client.query(reserveQuery, [userId, code, expiresAt]);
    await client.query('COMMIT');
    return { reserved: result.rows[0], recentCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error reserving email verification code', {
      error: error.message,
      userId,
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Make a reserved code the user's code, once its email has gone out: the
 * codes active until now are retired and the reservation becomes active, in
 * one statement under the account's lock — two resends finishing together
 * leave one active code, the one activated last (the later letter).
 *
 * Reservations still in flight are not touched (they are not active), so a
 * resend finishing first cannot retire a code whose letter is still on the way.
 *
 * @param {string} userId
 * @param {string} codeId - From reserveCodeWithinLimit
 * @returns {Promise<Object|null>} The activated row; null if it is gone
 */
export const activateReservedCode = async (userId, codeId) => {
  // The two updates touch different rows: the reservation is not active, and
  // `id <> $2` says so outright. Without the reservation (the account was
  // deleted meanwhile) nothing is retired.
  const query = `
    WITH retired AS (
      UPDATE email_verification_codes
      SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND used_at IS NULL AND id <> $2
        AND EXISTS (SELECT 1 FROM email_verification_codes WHERE id = $2 AND user_id = $1)
    )
    UPDATE email_verification_codes
    SET used_at = NULL
    WHERE id = $2 AND user_id = $1
    RETURNING id, user_id, code, expires_at, created_at, used_at, attempts
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAccountCodes(client, userId);
    const result = await client.query(query, [userId, codeId]);
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error activating email verification code', {
      error: error.message,
      userId,
      codeId,
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Remove a reservation whose email did not go out — it leaves the hourly
 * count, and the codes the user holds were never touched.
 *
 * @param {string} codeId - From reserveCodeWithinLimit
 * @returns {Promise<boolean>} True if the row was removed
 */
export const deleteReservedCode = async (codeId) => {
  const query = `
    DELETE FROM email_verification_codes
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [codeId]);
    return result.rowCount > 0;
  } catch (error) {
    logger.error('Error deleting reserved email verification code', {
      error: error.message,
      codeId,
    });
    throw error;
  }
};

/**
 * Increment the attempts counter for a code (anti-bruteforce).
 *
 * @param {string} codeId
 * @returns {Promise<number>} New attempts value
 */
export const incrementAttempts = async (codeId) => {
  const query = `
    UPDATE email_verification_codes
    SET attempts = attempts + 1
    WHERE id = $1
    RETURNING attempts
  `;

  try {
    const result = await pool.query(query, [codeId]);
    return result.rows[0]?.attempts ?? 0;
  } catch (error) {
    logger.error('Error incrementing verification attempts', {
      error: error.message,
      codeId,
    });
    throw error;
  }
};

/**
 * Mark a code as used (consumed by successful verification or
 * forcibly invalidated after attempts exhausted).
 *
 * @param {string} codeId
 * @returns {Promise<boolean>} True if a row was updated
 */
export const markAsUsed = async (codeId) => {
  const query = `
    UPDATE email_verification_codes
    SET used_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND used_at IS NULL
  `;

  try {
    const result = await pool.query(query, [codeId]);
    return result.rowCount > 0;
  } catch (error) {
    logger.error('Error marking code as used', {
      error: error.message,
      codeId,
    });
    throw error;
  }
};
