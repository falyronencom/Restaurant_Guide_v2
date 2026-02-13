/**
 * Admin Review Model
 *
 * Database access methods for admin review management.
 * Separate from reviewModel.js to avoid bloating the public review queries.
 * Admin queries include deleted/hidden reviews and JOIN with users + establishments.
 *
 * Segment E: Utility Screens
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Build dynamic WHERE clause for admin review queries
 *
 * @param {Object} filters
 * @returns {{ whereClause: string, values: Array, paramIndex: number }}
 */
const buildReviewWhere = (filters) => {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (filters.establishment_id) {
    conditions.push(`r.establishment_id = $${paramIndex++}`);
    values.push(filters.establishment_id);
  }

  if (filters.user_id) {
    conditions.push(`r.user_id = $${paramIndex++}`);
    values.push(filters.user_id);
  }

  if (filters.rating) {
    conditions.push(`r.rating = $${paramIndex++}`);
    values.push(parseInt(filters.rating, 10));
  }

  // Status mapping: visible, hidden, deleted
  if (filters.status === 'visible') {
    conditions.push('r.is_visible = true AND r.is_deleted = false');
  } else if (filters.status === 'hidden') {
    conditions.push('r.is_visible = false AND r.is_deleted = false');
  } else if (filters.status === 'deleted') {
    conditions.push('r.is_deleted = true');
  }
  // No filter = show all (including deleted and hidden)

  if (filters.search) {
    conditions.push(`COALESCE(r.content, r.text, '') ILIKE $${paramIndex++}`);
    values.push(`%${filters.search}%`);
  }

  if (filters.from) {
    conditions.push(`r.created_at >= $${paramIndex++}`);
    values.push(filters.from);
  }

  if (filters.to) {
    conditions.push(`r.created_at <= $${paramIndex++}`);
    values.push(filters.to);
  }

  const whereClause = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : '';

  return { whereClause, values, paramIndex };
};

/**
 * Get paginated reviews for admin management
 * Includes deleted/hidden reviews, author info, establishment info
 *
 * @param {Object} filters
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>}
 */
export const getAdminReviews = async (filters = {}, limit = 20, offset = 0) => {
  const { whereClause, values, paramIndex } = buildReviewWhere(filters);

  // Sort options
  const sortMap = {
    newest: 'r.created_at DESC',
    oldest: 'r.created_at ASC',
    rating_high: 'r.rating DESC, r.created_at DESC',
    rating_low: 'r.rating ASC, r.created_at DESC',
  };
  const orderBy = sortMap[filters.sort] || sortMap.newest;

  const query = `
    SELECT
      r.id,
      r.rating,
      COALESCE(r.content, r.text) as content,
      r.is_deleted,
      r.is_visible,
      r.is_edited,
      r.created_at,
      r.partner_response,
      r.partner_response_at,
      CASE WHEN r.partner_response IS NOT NULL THEN true ELSE false END as has_partner_response,
      u.name as author_name,
      u.email as author_email,
      e.name as establishment_name,
      e.city as establishment_city,
      e.id as establishment_id
    FROM reviews r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN establishments e ON r.establishment_id = e.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  try {
    const result = await pool.query(query, [...values, limit, offset]);

    logger.debug('Fetched admin reviews', {
      count: result.rows.length,
      filters: { status: filters.status, rating: filters.rating },
      limit,
      offset,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching admin reviews', {
      error: error.message,
      filters,
    });
    throw error;
  }
};

/**
 * Count reviews matching filters (for pagination)
 *
 * @param {Object} filters
 * @returns {Promise<number>}
 */
export const countAdminReviews = async (filters = {}) => {
  const { whereClause, values } = buildReviewWhere(filters);

  const query = `
    SELECT COUNT(*) as total
    FROM reviews r
    ${whereClause}
  `;

  try {
    const result = await pool.query(query, values);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting admin reviews', {
      error: error.message,
      filters,
    });
    throw error;
  }
};

/**
 * Toggle review visibility (is_visible = NOT is_visible)
 *
 * @param {string} reviewId - UUID of the review
 * @returns {Promise<Object|null>} Updated review { id, is_visible } or null if not found
 */
export const toggleReviewVisibility = async (reviewId) => {
  const query = `
    UPDATE reviews
    SET
      is_visible = NOT is_visible,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    AND is_deleted = false
    RETURNING id, is_visible
  `;

  try {
    const result = await pool.query(query, [reviewId]);

    if (result.rows.length === 0) {
      return null;
    }

    logger.info('Review visibility toggled', {
      reviewId,
      newVisibility: result.rows[0].is_visible,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error toggling review visibility', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Get review by ID with establishment_id (for aggregate updates after delete)
 *
 * @param {string} reviewId
 * @returns {Promise<Object|null>}
 */
export const getReviewForAdmin = async (reviewId) => {
  const query = `
    SELECT id, establishment_id, is_deleted, is_visible
    FROM reviews
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [reviewId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching review for admin', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};
