/**
 * Notification Preferences Model
 *
 * Database access methods for the notification_preferences table.
 * UPSERT pattern (same as booking_settings): one row per user,
 * created on first write, updated on subsequent writes.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/** Default preferences returned when no row exists for a user */
const DEFAULTS = {
  booking_push_enabled: true,
  reviews_push_enabled: true,
  promotions_push_enabled: true,
};

/**
 * Get preferences for a user (returns defaults if no row exists)
 *
 * @param {string} userId
 * @returns {Promise<Object>} Preferences object
 */
export const getByUserId = async (userId) => {
  const query = `
    SELECT id, user_id, booking_push_enabled, reviews_push_enabled,
           promotions_push_enabled, created_at, updated_at
    FROM notification_preferences
    WHERE user_id = $1
  `;

  try {
    const result = await pool.query(query, [userId]);
    if (result.rows[0]) {
      return result.rows[0];
    }
    // Return defaults with userId but no id (row doesn't exist yet)
    return { user_id: userId, ...DEFAULTS };
  } catch (error) {
    logger.error('Error getting notification preferences', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Create or update preferences (UPSERT)
 *
 * Supports partial update — only specified fields are changed.
 * Unspecified fields keep their current value (or default on first create).
 *
 * @param {string} userId
 * @param {Object} prefs
 * @param {boolean} [prefs.booking_push_enabled]
 * @param {boolean} [prefs.reviews_push_enabled]
 * @param {boolean} [prefs.promotions_push_enabled]
 * @returns {Promise<Object>} Updated preferences
 */
export const upsert = async (userId, prefs) => {
  const {
    booking_push_enabled,
    reviews_push_enabled,
    promotions_push_enabled,
  } = prefs;

  const query = `
    INSERT INTO notification_preferences (user_id, booking_push_enabled, reviews_push_enabled, promotions_push_enabled)
    VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE))
    ON CONFLICT (user_id)
    DO UPDATE SET
      booking_push_enabled = COALESCE($2, notification_preferences.booking_push_enabled),
      reviews_push_enabled = COALESCE($3, notification_preferences.reviews_push_enabled),
      promotions_push_enabled = COALESCE($4, notification_preferences.promotions_push_enabled),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, user_id, booking_push_enabled, reviews_push_enabled,
              promotions_push_enabled, created_at, updated_at
  `;

  try {
    const result = await pool.query(query, [
      userId,
      booking_push_enabled ?? null,
      reviews_push_enabled ?? null,
      promotions_push_enabled ?? null,
    ]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error upserting notification preferences', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Delete preferences for a user (account cleanup)
 *
 * @param {string} userId
 * @returns {Promise<number>} Number of deleted rows
 */
export const deleteByUserId = async (userId) => {
  const query = `
    DELETE FROM notification_preferences
    WHERE user_id = $1
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error deleting notification preferences', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

export { DEFAULTS };
