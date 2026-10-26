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
 * Lifecycle: createTokenWithinLimit → the letter went out:
 * retireTokensIssuedBefore / did not: deleteToken → findValidByTokenHash →
 * markAsUsed (or expire).
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

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

const COUNT_RECENT_QUERY = `
  SELECT COUNT(*)::int AS count
  FROM password_reset_tokens
  WHERE user_id = $1
    AND created_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
`;

/**
 * Insert a reset token, if the account is under its hourly limit — the count
 * and the insert under the account's lock, so requests that arrive together
 * are counted one after another and the limit holds. Until 25.10 the count
 * and the insert were separate statements: requests in flight together all
 * saw the same count.
 *
 * The new token is active at once — a link in a letter that has gone out
 * must work from the moment the letter can be opened — and the earlier ones
 * stay active too, until the letter goes out (retireTokensIssuedBefore). A
 * letter that did not go out takes its token away (deleteToken), so it does
 * not count.
 *
 * created_at is the clock at the insert, not the transaction's start: a
 * request that began first but waited for the lock is issued later, and its
 * token must read as the later one.
 *
 * @param {string} userId
 * @param {string} tokenHash - SHA-256 hex digest of the raw token
 * @param {Date} expiresAt
 * @param {Object} limit
 * @param {number} limit.max - Tokens allowed within the window
 * @param {number} limit.minutes - The window
 * @returns {Promise<{token: Object|null, recentCount: number}>} token is null
 *   when the limit is reached; recentCount — tokens in the window before this one
 */
export const createTokenWithinLimit = async (userId, tokenHash, expiresAt, { max, minutes }) => {
  const insertQuery = `
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
    VALUES ($1, $2, $3, clock_timestamp())
    RETURNING id, user_id, token_hash, expires_at, created_at, used_at
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Advisory: no row is locked, other accounts and other writers of the
    // table do not wait.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`password_reset_tokens:${userId}`]);
    // A statement of its own, after the lock: under READ COMMITTED it sees
    // every token committed by the requests that held the lock before.
    const recentCount = (await client.query(COUNT_RECENT_QUERY, [userId, String(minutes)])).rows[0].count;
    if (recentCount >= max) {
      await client.query('ROLLBACK');
      return { token: null, recentCount };
    }
    const result = await client.query(insertQuery, [userId, tokenHash, expiresAt]);
    await client.query('COMMIT');
    return { token: result.rows[0], recentCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Error creating password reset token within limit', {
      error: error.message,
      userId,
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Retire the user's active tokens issued before the given one — called once
 * the letter with that token has gone out, so only the latest emailed link
 * works. Tokens issued after it (their letters still on the way) are left
 * alone: of two requests finishing in either order, the later-issued link
 * survives, and the two never retire each other.
 *
 * @param {string} userId
 * @param {string} tokenId - The token whose letter went out
 * @returns {Promise<number>} Rows affected
 */
export const retireTokensIssuedBefore = async (userId, tokenId) => {
  const query = `
    UPDATE password_reset_tokens
    SET used_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
      AND used_at IS NULL
      AND created_at < (SELECT created_at FROM password_reset_tokens WHERE id = $2)
  `;

  try {
    const result = await pool.query(query, [userId, tokenId]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error retiring earlier reset tokens for user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Remove a token whose letter did not go out: no one holds its link, and it
 * leaves the hourly count.
 *
 * @param {string} tokenId
 * @returns {Promise<boolean>} True if the row was removed
 */
export const deleteToken = async (tokenId) => {
  const query = `
    DELETE FROM password_reset_tokens
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [tokenId]);
    return result.rowCount > 0;
  } catch (error) {
    logger.error('Error deleting password reset token', {
      error: error.message,
      tokenId,
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
