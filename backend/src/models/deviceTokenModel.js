/**
 * Device Token Model
 *
 * Database access methods for the device_tokens table.
 * Manages FCM registration tokens for push notification delivery.
 * UPSERT pattern: same token re-registered reactivates and updates timestamp.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Create or reactivate a device token (UPSERT)
 *
 * If the (user_id, fcm_token) pair already exists, updates updated_at
 * and sets is_active = true. This handles token re-registration on app restart.
 *
 * One device, one active account: an FCM token belongs to the app install,
 * not to a person. When another account signs in on the same phone and
 * registers the token, the token is switched off for every other account
 * in the same statement — otherwise the previous account's pushes keep
 * arriving on a phone it has left. Uniqueness in the schema is per
 * (user_id, fcm_token), so the rule lives here, without a migration.
 * The released rows stay (is_active = FALSE): signing back in reactivates.
 *
 * @param {Object} data
 * @param {string} data.userId
 * @param {string} data.fcmToken
 * @param {string} data.platform - 'ios' | 'android'
 * @param {string} [data.deviceName]
 * @returns {Promise<Object>} Created or updated token record
 */
export const create = async (data) => {
  const { userId, fcmToken, platform, deviceName = null } = data;

  // A data-modifying CTE runs exactly once whether or not the INSERT reads
  // it; both parts are one statement, hence one transaction. The caller's
  // own row is left to ON CONFLICT (user_id <> $1): one statement must not
  // modify the same row twice — Postgres does not define which change wins.
  const query = `
    WITH released AS (
      UPDATE device_tokens
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE fcm_token = $2 AND user_id <> $1 AND is_active = TRUE
    )
    INSERT INTO device_tokens (user_id, fcm_token, platform, device_name)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, fcm_token)
    DO UPDATE SET
      is_active = TRUE,
      device_name = COALESCE(EXCLUDED.device_name, device_tokens.device_name),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, user_id, fcm_token, platform, device_name, is_active, created_at, updated_at
  `;

  try {
    const result = await pool.query(query, [userId, fcmToken, platform, deviceName]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating device token', {
      error: error.message,
      userId,
      platform,
    });
    throw error;
  }
};

/**
 * Find all active tokens for a user
 *
 * Only while the account itself is active: a switched-off account
 * (users.is_active = false) gets no pushes — booking details included — on
 * the devices it was signed in on. Its token rows stay as they are, so
 * switching the account back on brings its pushes back.
 *
 * @param {string} userId
 * @returns {Promise<Array>} Active device tokens
 */
export const findByUserId = async (userId) => {
  const query = `
    SELECT dt.id, dt.user_id, dt.fcm_token, dt.platform, dt.device_name, dt.created_at, dt.updated_at
    FROM device_tokens dt
    JOIN users u ON u.id = dt.user_id AND u.is_active = TRUE
    WHERE dt.user_id = $1 AND dt.is_active = TRUE
    ORDER BY dt.updated_at DESC
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows;
  } catch (error) {
    logger.error('Error finding device tokens', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Deactivate a token (set is_active = false)
 *
 * Used on logout or when FCM reports token as stale.
 *
 * @param {string} fcmToken
 * @returns {Promise<number>} Number of rows affected
 */
export const deactivate = async (fcmToken) => {
  const query = `
    UPDATE device_tokens
    SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE fcm_token = $1 AND is_active = TRUE
  `;

  try {
    const result = await pool.query(query, [fcmToken]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error deactivating device token', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Deactivate a token for a specific user (scoped by userId for security)
 *
 * @param {string} fcmToken
 * @param {string} userId
 * @returns {Promise<number>} Number of rows affected
 */
export const deactivateForUser = async (fcmToken, userId) => {
  const query = `
    UPDATE device_tokens
    SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE fcm_token = $1 AND user_id = $2 AND is_active = TRUE
  `;

  try {
    const result = await pool.query(query, [fcmToken, userId]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error deactivating device token for user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Delete all tokens for a user (account cleanup)
 *
 * @param {string} userId
 * @returns {Promise<number>} Number of deleted rows
 */
export const deleteByUserId = async (userId) => {
  const query = `
    DELETE FROM device_tokens
    WHERE user_id = $1
  `;

  try {
    const result = await pool.query(query, [userId]);
    logger.info('Device tokens deleted for user', {
      userId,
      deleted: result.rowCount,
    });
    return result.rowCount;
  } catch (error) {
    logger.error('Error deleting device tokens', {
      error: error.message,
      userId,
    });
    throw error;
  }
};
