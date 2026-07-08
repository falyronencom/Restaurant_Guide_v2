/**
 * Password Reset Model
 *
 * Database access for password_reset_tokens table (migration 032).
 * Manages single-use reset tokens sent to users via email deep link.
 *
 * Security note: this model only ever sees the SHA-256 hash of a token.
 * The raw token exists in the reset email and transiently in the service
 * layer — it is never persisted, so a database leak yields nothing usable.
 *
 * Lifecycle: createToken → findValidByTokenHash → markAsUsed (or expire).
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Insert a new reset token for a user.
 *
 * @param {string} userId
 * @param {string} tokenHash - SHA-256 hex digest of the raw token
 * @param {Date} expiresAt
 * @returns {Promise<Object>} Created row
 */
export const createToken = async (userId, tokenHash, expiresAt) => {
  const query = `
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
    RETURNING id, user_id, token_hash, expires_at, created_at, used_at
  `;

  try {
    const result = await pool.query(query, [userId, tokenHash, expiresAt]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating password reset token', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Find a valid (unused, unexpired) token row by its hash.
 *
 * @param {string} tokenHash - SHA-256 hex digest of the submitted token
 * @returns {Promise<Object|null>}
 */
export const findValidByTokenHash = async (tokenHash) => {
  const query = `
    SELECT id, user_id, token_hash, expires_at, created_at, used_at
    FROM password_reset_tokens
    WHERE token_hash = $1
      AND used_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [tokenHash]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    logger.error('Error finding password reset token', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Count tokens created within the last N minutes for a user.
 * Service layer uses this as a per-user issue throttle (anti email-bombing),
 * mirroring countRecentSends in emailVerificationModel.
 *
 * @param {string} userId
 * @param {number} minutes
 * @returns {Promise<number>}
 */
export const countRecentRequests = async (userId, minutes) => {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM password_reset_tokens
    WHERE user_id = $1
      AND created_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
  `;

  try {
    const result = await pool.query(query, [userId, String(minutes)]);
    return result.rows[0].count;
  } catch (error) {
    logger.error('Error counting recent password reset requests', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Invalidate all active tokens for a user (called before issuing a new one,
 * so only the latest emailed link works).
 *
 * @param {string} userId
 * @returns {Promise<number>} Rows affected
 */
export const invalidateActiveTokensForUser = async (userId) => {
  const query = `
    UPDATE password_reset_tokens
    SET used_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND used_at IS NULL
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error invalidating active reset tokens for user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Mark a token as used. The `used_at IS NULL` predicate makes this an atomic
 * single-use claim: of two concurrent consumers, exactly one gets rowCount=1.
 *
 * @param {string} tokenId
 * @returns {Promise<boolean>} True if this call claimed the token
 */
export const markAsUsed = async (tokenId) => {
  const query = `
    UPDATE password_reset_tokens
    SET used_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND used_at IS NULL
  `;

  try {
    const result = await pool.query(query, [tokenId]);
    return result.rowCount > 0;
  } catch (error) {
    logger.error('Error marking reset token as used', {
      error: error.message,
      tokenId,
    });
    throw error;
  }
};
