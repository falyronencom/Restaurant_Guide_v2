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
 * @param {Object} data
 * @param {string} data.userId
 * @param {string} data.fcmToken
 * @param {string} data.platform - 'ios' | 'android'
 * @param {string} [data.deviceName]
 * @returns {Promise<Object>} Created or updated token record
 */
export const create = async (data) => {
  const { userId, fcmToken, platform, deviceName = null } = data;

  const query = `
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
 * @param {string} userId
 * @returns {Promise<Array>} Active device tokens
 */
export const findByUserId = async (userId) => {
  const query = `
    SELECT id, user_id, fcm_token, platform, device_name, created_at, updated_at
    FROM device_tokens
    WHERE user_id = $1 AND is_active = TRUE
    ORDER BY updated_at DESC
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
