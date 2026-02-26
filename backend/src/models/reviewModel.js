/**
 * Review Model
 * 
 * This model provides database access methods for the reviews table.
 * It encapsulates all SQL queries and returns plain JavaScript objects.
 * 
 * Architecture note: This is the first model in the project and establishes
 * patterns for future models. Models should be thin data access layers that
 * know about SQL and database structure, but not about business rules.
 * Business logic lives in the service layer.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Create a new review in the database
 * 
 * @param {Object} reviewData - The review data to insert
 * @param {string} reviewData.user_id - UUID of the user creating the review
 * @param {string} reviewData.establishment_id - UUID of the establishment being reviewed
 * @param {number} reviewData.rating - Rating from 1 to 5
 * @param {string} reviewData.content - Review text content (20-1000 characters)
 * @returns {Promise<Object>} The created review object with all database fields
 * @throws {Error} If database operation fails
 */
export const createReview = async (reviewData) => {
  const { user_id, establishment_id, rating, content } = reviewData;

  const query = `
    INSERT INTO reviews (user_id, establishment_id, rating, content, text)
    VALUES ($1, $2, $3, $4, $4)
    RETURNING
      id,
      user_id,
      establishment_id,
      rating,
      content,
      created_at,
      updated_at
  `;

  const values = [user_id, establishment_id, rating, content];

  try {
    const result = await pool.query(query, values);
    logger.info('Review created', {
      reviewId: result.rows[0].id,
      userId: user_id,
      establishmentId: establishment_id,
    });
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating review', {
      error: error.message,
      userId: user_id,
      establishmentId: establishment_id,
    });
    throw error;
  }
};

/**
 * Find a review by its ID
 * 
 * @param {string} reviewId - UUID of the review to find
 * @param {boolean} includeDeleted - Whether to include soft-deleted reviews (default: false)
 * @returns {Promise<Object|null>} The review object or null if not found
 */
export const findReviewById = async (reviewId, _includeDeleted = false) => {
  const query = `
    SELECT
      r.id,
      r.user_id,
      r.establishment_id,
      r.rating,
      COALESCE(r.content, r.text) as content,
      r.partner_response,
      r.partner_response_at,
      r.partner_responder_id,
      r.is_deleted,
      r.is_visible,
      r.is_edited,
      r.created_at,
      r.updated_at,
      u.name as author_name,
      u.email as author_email,
      u.avatar_url as author_avatar
    FROM reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.id = $1
  `;

  try {
    const result = await pool.query(query, [reviewId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error finding review by ID', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Find all reviews for a specific establishment
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of reviews to return (default: 10)
 * @param {number} options.offset - Number of reviews to skip for pagination (default: 0)
 * @param {string} options.sortBy - Sort order: 'newest', 'highest', 'lowest' (default: 'newest')
 * @param {boolean} options.includeDeleted - Whether to include soft-deleted reviews (default: false)
 * @returns {Promise<Array>} Array of review objects with author information
 */
export const findReviewsByEstablishment = async (establishmentId, options = {}) => {
  const {
    limit = 10,
    offset = 0,
    sortBy = 'newest',
    includeDeleted = false,
    dateFrom,
    dateTo,
  } = options;

  // Determine sort order based on sortBy parameter
  let orderClause = 'r.created_at DESC'; // Default: newest first
  if (sortBy === 'highest') {
    orderClause = 'r.rating DESC, r.created_at DESC';
  } else if (sortBy === 'lowest') {
    orderClause = 'r.rating ASC, r.created_at DESC';
  }

  // Build dynamic WHERE conditions and params
  const conditions = ['r.establishment_id = $1'];
  const values = [establishmentId];
  let paramIdx = 2;

  if (!includeDeleted) {
    conditions.push('r.is_deleted = false');
  }
  if (dateFrom) {
    conditions.push(`r.created_at >= $${paramIdx}`);
    values.push(dateFrom);
    paramIdx++;
  }
  if (dateTo) {
    conditions.push(`r.created_at <= $${paramIdx}`);
    values.push(dateTo);
    paramIdx++;
  }

  values.push(limit, offset);

  const query = `
    SELECT
      r.id,
      r.user_id,
      r.establishment_id,
      r.rating,
      COALESCE(r.content, r.text) as content,
      r.partner_response,
      r.partner_response_at,
      r.partner_responder_id,
      r.is_deleted,
      r.is_visible,
      r.is_edited,
      r.created_at,
      r.updated_at,
      u.name as author_name,
      u.email as author_email,
      u.avatar_url as author_avatar
    FROM reviews r
    JOIN users u ON r.user_id = u.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderClause}
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;

  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    logger.error('Error finding reviews by establishment', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Count total reviews for a specific establishment
 * Used for pagination metadata
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {boolean} includeDeleted - Whether to include soft-deleted reviews (default: false)
 * @returns {Promise<number>} Total count of reviews
 */
export const countReviewsByEstablishment = async (establishmentId, options = {}) => {
  const { includeDeleted = false, dateFrom, dateTo } = typeof options === 'boolean'
    ? { includeDeleted: options }   // backwards-compat: old callers pass boolean
    : options;

  const conditions = ['establishment_id = $1'];
  const values = [establishmentId];
  let paramIdx = 2;

  if (!includeDeleted) {
    conditions.push('is_deleted = false');
  }
  if (dateFrom) {
    conditions.push(`created_at >= $${paramIdx}`);
    values.push(dateFrom);
    paramIdx++;
  }
  if (dateTo) {
    conditions.push(`created_at <= $${paramIdx}`);
    values.push(dateTo);
    paramIdx++;
  }

  const query = `
    SELECT COUNT(*) as count
    FROM reviews
    WHERE ${conditions.join(' AND ')}
  `;

  try {
    const result = await pool.query(query, values);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    logger.error('Error counting reviews by establishment', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Find all reviews written by a specific user
 * 
 * @param {string} userId - UUID of the user
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of reviews to return (default: 10)
 * @param {number} options.offset - Number of reviews to skip for pagination (default: 0)
 * @param {boolean} options.includeDeleted - Whether to include soft-deleted reviews (default: false)
 * @returns {Promise<Array>} Array of review objects with establishment information
 */
export const findReviewsByUser = async (userId, options = {}) => {
  const {
    limit = 10,
    offset = 0,
    includeDeleted = false,
  } = options;

  const query = `
    SELECT 
      r.id, 
      r.user_id, 
      r.establishment_id, 
      r.rating, 
      COALESCE(r.content, r.text) as content, 
      r.partner_response,
      r.partner_response_at,
      r.partner_responder_id,
      r.is_deleted,
      r.is_visible,
      r.is_edited,
      r.created_at, 
      r.updated_at,
      e.name as establishment_name,
      e.city as establishment_city,
      e.categories as establishment_categories
    FROM reviews r
    JOIN establishments e ON r.establishment_id = e.id
    WHERE r.user_id = $1
    ${includeDeleted ? '' : 'AND r.is_deleted = false'}
    ORDER BY r.created_at DESC
    LIMIT $2 OFFSET $3
  `;

  try {
    const result = await pool.query(query, [userId, limit, offset]);
    return result.rows;
  } catch (error) {
    logger.error('Error finding reviews by user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Count total reviews written by a specific user
 * Used for pagination metadata
 * 
 * @param {string} userId - UUID of the user
 * @param {boolean} includeDeleted - Whether to include soft-deleted reviews (default: false)
 * @returns {Promise<number>} Total count of reviews
 */
export const countReviewsByUser = async (userId, includeDeleted = false) => {
  const query = `
    SELECT COUNT(*) as count
    FROM reviews
    WHERE user_id = $1
    ${includeDeleted ? '' : 'AND is_deleted = false'}
  `;

  try {
    const result = await pool.query(query, [userId]);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    logger.error('Error counting reviews by user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Check if a user has already reviewed a specific establishment
 * 
 * @param {string} userId - UUID of the user
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<Object|null>} Existing review object or null if no review found
 */
export const findExistingReview = async (userId, establishmentId) => {
  const query = `
    SELECT
      id,
      user_id,
      establishment_id,
      rating,
      COALESCE(content, text) as content,
      created_at,
      updated_at
    FROM reviews
    WHERE user_id = $1
    AND establishment_id = $2
  `;

  try {
    const result = await pool.query(query, [userId, establishmentId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error finding existing review', {
      error: error.message,
      userId,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Update an existing review
 * 
 * @param {string} reviewId - UUID of the review to update
 * @param {Object} updates - Fields to update
 * @param {number} [updates.rating] - New rating (optional)
 * @param {string} [updates.content] - New content (optional)
 * @returns {Promise<Object>} The updated review object
 * @throws {Error} If review not found or database operation fails
 */
export const updateReview = async (reviewId, updates) => {
  const fields = [];
  const values = [];
  let paramCount = 1;

  // Build dynamic UPDATE query based on provided fields
  if (updates.rating !== undefined) {
    fields.push(`rating = $${paramCount}`);
    values.push(updates.rating);
    paramCount++;
  }

  if (updates.content !== undefined) {
    fields.push(`content = $${paramCount}`);
    fields.push(`text = $${paramCount}`); // keep legacy column in sync
    values.push(updates.content);
    paramCount++;
  }

  // Always update updated_at timestamp and set is_edited flag
  fields.push('updated_at = CURRENT_TIMESTAMP');
  fields.push('is_edited = true');

  // Add reviewId as the last parameter
  values.push(reviewId);

  const query = `
    UPDATE reviews
    SET ${fields.join(', ')}
    WHERE id = $${paramCount}
    AND is_deleted = false
    RETURNING 
      id, 
      user_id, 
      establishment_id, 
      rating, 
      content,
      partner_response,
      partner_response_at,
      partner_responder_id,
      is_deleted,
      is_visible,
      is_edited,
      created_at, 
      updated_at
  `;

  try {
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Review not found or already deleted');
    }

    logger.info('Review updated', {
      reviewId,
      updatedFields: Object.keys(updates),
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error updating review', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Soft delete a review (set is_deleted flag to true)
 * 
 * @param {string} reviewId - UUID of the review to delete
 * @returns {Promise<boolean>} True if deletion successful, false if review not found
 */
export const softDeleteReview = async (reviewId) => {
  const query = `
    UPDATE reviews
    SET 
      is_deleted = true,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    AND is_deleted = false
    RETURNING id
  `;

  try {
    const result = await pool.query(query, [reviewId]);
    
    if (result.rows.length === 0) {
      return false; // Review not found or already deleted
    }

    logger.info('Review soft deleted', { reviewId });
    return true;
  } catch (error) {
    logger.error('Error soft deleting review', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Hard delete a review (permanently remove from database)
 * This should rarely be used - soft deletion is preferred
 * 
 * @param {string} reviewId - UUID of the review to permanently delete
 * @returns {Promise<boolean>} True if deletion successful, false if review not found
 */
export const hardDeleteReview = async (reviewId) => {
  const query = `
    DELETE FROM reviews
    WHERE id = $1
    RETURNING id
  `;

  try {
    const result = await pool.query(query, [reviewId]);
    
    if (result.rows.length === 0) {
      return false; // Review not found
    }

    logger.warn('Review hard deleted', { reviewId });
    return true;
  } catch (error) {
    logger.error('Error hard deleting review', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Update aggregate statistics for an establishment
 * Recalculates average_rating and review_count based on non-deleted reviews
 * 
 * This function should be called after any review create, update, or delete operation
 * to ensure aggregate statistics stay in sync with actual review data.
 * 
 * @param {string} establishmentId - UUID of the establishment to update
 * @returns {Promise<Object>} Object with updated average_rating and review_count
 */
export const updateEstablishmentAggregates = async (establishmentId) => {
  const query = `
    UPDATE establishments
    SET
      average_rating = (
        SELECT AVG(rating)::DECIMAL(3,2)
        FROM reviews
        WHERE establishment_id = $1
        AND is_deleted = false
      ),
      review_count = (
        SELECT COUNT(*)
        FROM reviews
        WHERE establishment_id = $1
        AND is_deleted = false
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING average_rating, review_count
  `;

  try {
    const result = await pool.query(query, [establishmentId]);
    
    if (result.rows.length === 0) {
      throw new Error('Establishment not found');
    }

    const { average_rating, review_count } = result.rows[0];

    logger.info('Establishment aggregates updated', {
      establishmentId,
      averageRating: average_rating,
      reviewCount: review_count,
    });

    return { average_rating, review_count };
  } catch (error) {
    logger.error('Error updating establishment aggregates', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Get rating distribution for an establishment (count per star 1-5)
 *
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<Object>} Object like { "1": 0, "2": 3, "3": 5, "4": 12, "5": 8 }
 */
export const getRatingDistribution = async (establishmentId) => {
  const query = `
    SELECT rating, COUNT(*)::int as count
    FROM reviews
    WHERE establishment_id = $1
      AND is_deleted = false
    GROUP BY rating
    ORDER BY rating
  `;

  try {
    const result = await pool.query(query, [establishmentId]);

    // Build full distribution with zeros for missing ratings
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of result.rows) {
      distribution[row.rating] = row.count;
    }

    return distribution;
  } catch (error) {
    logger.error('Error fetching rating distribution', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Get review with establishment ownership information
 *
 * @param {string} reviewId - UUID of the review
 * @returns {Promise<Object|null>} Review + establishment ownership data
 */
export const getReviewWithEstablishment = async (reviewId) => {
  const query = `
    SELECT
      r.id,
      r.establishment_id,
      r.user_id,
      r.partner_response,
      r.partner_response_at,
      r.partner_responder_id,
      r.is_deleted,
      e.partner_id
    FROM reviews r
    JOIN establishments e ON r.establishment_id = e.id
    WHERE r.id = $1
  `;

  try {
    const result = await pool.query(query, [reviewId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting review with establishment', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Add partner response to a review (creates or overwrites existing response)
 * 
 * @param {string} reviewId - UUID of the review
 * @param {string} partnerId - UUID of the partner user writing the response
 * @param {string} responseText - Response content
 * @returns {Promise<Object>} Updated review row
 */
export const addPartnerResponse = async (reviewId, partnerId, responseText) => {
  const query = `
    UPDATE reviews
    SET
      partner_response = $1,
      partner_response_at = CURRENT_TIMESTAMP,
      partner_responder_id = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    AND is_deleted = false
    RETURNING
      id,
      user_id,
      establishment_id,
      rating,
      content,
      partner_response,
      partner_response_at,
      partner_responder_id,
      is_deleted,
      is_visible,
      is_edited,
      created_at,
      updated_at
  `;

  try {
    const result = await pool.query(query, [responseText, partnerId, reviewId]);

    if (result.rows.length === 0) {
      throw new Error('Review not found or already deleted');
    }

    logger.info('Partner response added/updated', {
      reviewId,
      partnerId,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error adding partner response', {
      error: error.message,
      reviewId,
      partnerId,
    });
    throw error;
  }
};

/**
 * Update partner response (alias to addPartnerResponse for clarity)
 */
export const updatePartnerResponse = addPartnerResponse;

/**
 * Delete partner response from a review
 * 
 * @param {string} reviewId - UUID of the review
 * @returns {Promise<Object>} Updated review row
 */
export const deletePartnerResponse = async (reviewId) => {
  const query = `
    UPDATE reviews
    SET
      partner_response = NULL,
      partner_response_at = NULL,
      partner_responder_id = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    AND is_deleted = false
    RETURNING
      id,
      user_id,
      establishment_id,
      rating,
      content,
      partner_response,
      partner_response_at,
      partner_responder_id,
      is_deleted,
      is_visible,
      is_edited,
      created_at,
      updated_at
  `;

  try {
    const result = await pool.query(query, [reviewId]);

    if (result.rows.length === 0) {
      throw new Error('Review not found or already deleted');
    }

    logger.info('Partner response deleted', { reviewId });

    return result.rows[0];
  } catch (error) {
    logger.error('Error deleting partner response', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Execute a function within a database transaction
 * This is a utility method for service layer to use when multiple operations
 * must succeed or fail together (atomicity requirement)
 * 
 * @param {Function} callback - Async function that receives database client
 * @returns {Promise<any>} Result from callback function
 */
export const executeInTransaction = async (callback) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Verify that an establishment exists in the database
 * This is used for validation before creating or updating reviews
 * 
 * @param {string} establishmentId - UUID of the establishment to verify
 * @returns {Promise<boolean>} True if establishment exists, false otherwise
 */
export const establishmentExists = async (establishmentId) => {
  const query = `
    SELECT EXISTS(
      SELECT 1 FROM establishments
      WHERE id = $1 AND status != 'archived'
    ) as exists
  `;

  try {
    const result = await pool.query(query, [establishmentId]);
    return result.rows[0].exists;
  } catch (error) {
    logger.error('Error checking establishment existence', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Get user information by user ID
 * Used to verify user exists and is active before operations
 * 
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object|null>} User object or null if not found
 */
export const getUserById = async (userId) => {
  const query = `
    SELECT id, email, name, role, is_active
    FROM users
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting user by ID', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

