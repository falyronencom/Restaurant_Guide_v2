/**
 * Email Verification Model
 *
 * Database access for email_verification_codes table (migration 026).
 * Manages 6-digit codes sent to users for email verification.
 *
 * Lifecycle: createCode → findActiveCodeForUser → markAsUsed (or expire).
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
 * Invalidate all active codes for a user (called before issuing a new one
 * on resend, to ensure only the latest code is valid).
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
