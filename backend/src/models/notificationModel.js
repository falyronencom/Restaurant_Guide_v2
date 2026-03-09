/**
 * Notification Model
 *
 * Database access methods for the notifications table.
 * Thin data access layer — business logic lives in notificationService.js.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

// Entity type → notification type groupings for category filtering
const CATEGORY_TYPES = {
  establishments: [
    'establishment_approved',
    'establishment_rejected',
    'establishment_suspended',
    'new_review',
  ],
  reviews: [
    'partner_response',
    'review_hidden',
    'review_deleted',
  ],
};

/**
 * Create a notification
 *
 * @param {Object} data
 * @param {string} data.userId - Recipient user UUID
 * @param {string} data.type - Notification type
 * @param {string} data.title - Title text (Russian)
 * @param {string} [data.message] - Detail message
 * @param {string} [data.establishmentId] - Related establishment UUID
 * @param {string} [data.reviewId] - Related review UUID
 * @returns {Promise<Object>} Created notification
 */
export const create = async (data) => {
  const {
    userId,
    type,
    title,
    message = null,
    establishmentId = null,
    reviewId = null,
  } = data;

  const query = `
    INSERT INTO notifications (user_id, type, title, message, establishment_id, review_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, user_id, type, title, message, establishment_id, review_id, is_read, created_at
  `;

  try {
    const result = await pool.query(query, [
      userId, type, title, message, establishmentId, reviewId,
    ]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating notification', {
      error: error.message,
      userId,
      type,
    });
    throw error;
  }
};

/**
 * Get paginated notifications for a user
 *
 * @param {string} userId - User UUID
 * @param {Object} options
 * @param {number} [options.limit=20]
 * @param {number} [options.offset=0]
 * @param {boolean} [options.isRead] - Filter by read status (undefined = all)
 * @param {string} [options.category] - 'establishments' | 'reviews'
 * @returns {Promise<{items: Array, total: number}>}
 */
export const getByUserId = async (userId, options = {}) => {
  const { limit = 20, offset = 0, isRead, category } = options;

  const conditions = ['n.user_id = $1'];
  const values = [userId];
  let paramIndex = 2;

  if (typeof isRead === 'boolean') {
    conditions.push(`n.is_read = $${paramIndex++}`);
    values.push(isRead);
  }

  if (category && CATEGORY_TYPES[category]) {
    const types = CATEGORY_TYPES[category];
    const placeholders = types.map(() => `$${paramIndex++}`);
    conditions.push(`n.type IN (${placeholders.join(', ')})`);
    values.push(...types);
  }

  const whereClause = conditions.join(' AND ');

  const countQuery = `SELECT COUNT(*) as total FROM notifications n WHERE ${whereClause}`;
  const dataQuery = `
    SELECT
      n.id, n.type, n.title, n.message,
      n.establishment_id, n.review_id,
      n.is_read, n.created_at
    FROM notifications n
    WHERE ${whereClause}
    ORDER BY n.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, values),
      pool.query(dataQuery, [...values, limit, offset]),
    ]);

    return {
      items: dataResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
    };
  } catch (error) {
    logger.error('Error fetching notifications', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Get unread notification count for a user
 *
 * @param {string} userId
 * @returns {Promise<number>}
 */
export const getUnreadCount = async (userId) => {
  const query = `
    SELECT COUNT(*) as count
    FROM notifications
    WHERE user_id = $1 AND is_read = FALSE
  `;

  try {
    const result = await pool.query(query, [userId]);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    logger.error('Error getting unread count', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Mark a single notification as read (user can only mark own)
 *
 * @param {string} notificationId
 * @param {string} userId - Security: ensures ownership
 * @returns {Promise<Object|null>} Updated notification or null if not found/not owned
 */
export const markAsRead = async (notificationId, userId) => {
  const query = `
    UPDATE notifications
    SET is_read = TRUE
    WHERE id = $1 AND user_id = $2
    RETURNING id, is_read
  `;

  try {
    const result = await pool.query(query, [notificationId, userId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error marking notification as read', {
      error: error.message,
      notificationId,
      userId,
    });
    throw error;
  }
};

/**
 * Mark all unread notifications as read for a user
 *
 * @param {string} userId
 * @returns {Promise<number>} Number of notifications marked
 */
export const markAllAsRead = async (userId) => {
  const query = `
    UPDATE notifications
    SET is_read = TRUE
    WHERE user_id = $1 AND is_read = FALSE
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error marking all as read', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Delete notifications older than threshold (cleanup utility)
 *
 * @param {number} daysThreshold
 * @returns {Promise<number>} Number of deleted rows
 */
export const deleteOld = async (daysThreshold) => {
  const query = `
    DELETE FROM notifications
    WHERE created_at < NOW() - INTERVAL '1 day' * $1
  `;

  try {
    const result = await pool.query(query, [daysThreshold]);
    logger.info('Old notifications cleaned up', {
      deleted: result.rowCount,
      daysThreshold,
    });
    return result.rowCount;
  } catch (error) {
    logger.error('Error deleting old notifications', {
      error: error.message,
      daysThreshold,
    });
    throw error;
  }
};
