/**
 * Notification Model
 *
 * Database access methods for the notifications table.
 * Thin data access layer — business logic lives in notificationService.js.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { activeAccountRow } from './activeAccountSql.js';

// Entity type → notification type groupings for category filtering.
//
// `establishments` and `reviews` are the app's feed chips «Мои заведения» and
// «Мои отзывы» (the controller accepts only these two). «Мои заведения» holds
// what happens to the partner's own places — including a new review about
// one and the partner-side booking events; «Мои отзывы» holds what happens to
// reviews the user wrote. Guest-side bookings, `booking_expired` (one type
// goes to both guest and partner) and promotions stay in «Все» only.
// Coordinator's decision 17.10.2026 (variant «А-узкий»).
const CATEGORY_TYPES = {
  establishments: [
    'establishment_approved',
    'establishment_rejected',
    'establishment_suspended',
    'establishment_unsuspended',
    'establishment_claimed',
    'menu_parsed',
    'menu_item_hidden_by_admin',
    'new_review',
    'booking_received',
    'booking_cancelled',
  ],
  reviews: [
    'partner_response',
    'review_hidden',
    'review_deleted',
  ],
  booking: [
    'booking_received',
    'booking_confirmed',
    'booking_declined',
    'booking_expired',
    'booking_cancelled',
  ],
  promotions: [
    'promotion_new',
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
 * @returns {Promise<Object|undefined>} Created notification; undefined when the
 *   recipient's account is not active — switched off or deleted (below)
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

  // Only for an active account, read under a share lock (activeAccountSql.js):
  // a switched-off or deleted account opens no feed — its push was refused
  // already (deviceTokenModel.findByUserId) — and the feed of a deleted one
  // went with the deletion; a notice written after it lay under an account
  // nobody can open (critic 2Г, П3-03: a partner's answer to a «Гость» review,
  // a moderator hiding it).
  const query = `
    INSERT INTO notifications (user_id, type, title, message, establishment_id, review_id)
    SELECT account.id, $2, $3, $4, $5, $6 FROM ${activeAccountRow('$1')} account
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
 * One notice about an establishment to each user who keeps it in favorites, in
 * one statement: a mailing as one insert a row each would put in the pool as many
 * statements at once, and everyone else's requests would queue behind them. The
 * feed takes no account of notification preferences: those govern the push only.
 *
 * @param {Object} data
 * @param {string} data.establishmentId
 * @param {string} data.type
 * @param {string} data.title
 * @param {string} data.message
 * @returns {Promise<string[]>} The users written to
 */
export const createForEstablishmentFavorites = async ({ establishmentId, type, title, message }) => {
  // Active accounts only, as create() above; FOR SHARE OF u is the lock the
  // foreign key takes on each recipient anyway, made strong enough to wait
  // for a deletion in progress.
  const query = `
    INSERT INTO notifications (user_id, type, title, message, establishment_id)
    SELECT f.user_id, $2::text, $3::text, $4::text, f.establishment_id
    FROM favorites f
    JOIN users u ON u.id = f.user_id AND u.is_active = TRUE
    WHERE f.establishment_id = $1
    FOR SHARE OF u
    RETURNING user_id
  `;

  try {
    const result = await pool.query(query, [establishmentId, type, title, message]);
    return result.rows.map((row) => row.user_id);
  } catch (error) {
    logger.error('Error creating notifications for favorites', {
      error: error.message,
      establishmentId,
      type,
    });
    throw error;
  }
};

/**
 * One notice to the author of each of the given reviews, in one statement. The
 * same reading as one notice at a time: a review with no author is passed over
 * (ReviewModel.findReviewById joins users), so is an author whose account is
 * not active (create() above), and the message names the review's
 * establishment, or `fallbackName` if it has no name or is gone. All the notices
 * share one created_at, so the feed orders by id as well (getByUserId).
 *
 * @param {Object} data
 * @param {string[]} data.reviewIds
 * @param {string} data.type
 * @param {string} data.title
 * @param {string} data.messageTemplate - The message, with `nameSlot` for the name
 * @param {string} data.nameSlot
 * @param {string} data.fallbackName
 * @returns {Promise<number>} Notices written
 */
export const createForReviewAuthors = async ({
  reviewIds, type, title, messageTemplate, nameSlot, fallbackName,
}) => {
  const query = `
    INSERT INTO notifications (user_id, type, title, message, establishment_id, review_id)
    SELECT
      r.user_id,
      $2::text,
      $3::text,
      replace($4::text, $5::text, COALESCE(NULLIF(e.name, ''), $6::text)),
      r.establishment_id,
      r.id
    FROM reviews r
    JOIN users u ON u.id = r.user_id AND u.is_active = TRUE
    LEFT JOIN establishments e ON e.id = r.establishment_id
    WHERE r.id = ANY($1::uuid[])
    FOR SHARE OF u
  `;

  try {
    const result = await pool.query(query, [
      reviewIds, type, title, messageTemplate, nameSlot, fallbackName,
    ]);
    return result.rowCount;
  } catch (error) {
    logger.error('Error creating notifications for review authors', {
      error: error.message,
      count: reviewIds.length,
      type,
    });
    throw error;
  }
};

/**
 * Whether the user already has a notification of this type and title about
 * this establishment, created since the given OCR job was enqueued — the
 * jobs of one upload batch are enqueued together, so a notice written for
 * one of them is newer than the others' enqueue. Used by
 * notificationService.notifyMenuRecognitionFailed to tell the partner once
 * per batch, not once per failed file. Both timestamps are DB-generated naive
 * TIMESTAMPs, compared inside the database.
 *
 * @param {Object} params
 * @param {string} params.userId - Recipient UUID
 * @param {string} params.establishmentId - UUID
 * @param {string} params.type - Notification type
 * @param {string} params.title - Notification title
 * @param {string} params.jobId - UUID of the OCR job whose enqueue time bounds the search
 * @returns {Promise<boolean>}
 */
export const existsSinceOcrJobEnqueued = async ({ userId, establishmentId, type, title, jobId }) => {
  const result = await pool.query(
    `SELECT 1 FROM notifications
     WHERE user_id = $1 AND establishment_id = $2 AND type = $3 AND title = $4
       AND created_at >= (SELECT created_at FROM ocr_jobs WHERE id = $5)
     LIMIT 1`,
    [userId, establishmentId, type, title, jobId],
  );
  return result.rowCount > 0;
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
    ORDER BY n.created_at DESC, n.id DESC
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
