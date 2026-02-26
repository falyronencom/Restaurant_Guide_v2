/**
 * Establishment Model
 * 
 * This model provides database access methods for the establishments table.
 * It encapsulates all SQL queries related to partner-managed establishments
 * and returns plain JavaScript objects.
 * 
 * Architecture note: Models are thin data access layers that know about SQL
 * and database structure, but nothing about business rules. Business logic
 * lives in the service layer. This model follows patterns established in
 * reviewModel.js and favoriteModel.js for consistency.
 * 
 * CRITICAL: The establishments table uses:
 * - `cuisines` field (plural), NOT `cuisine_type`
 * - `status` as enum ('draft', 'pending', 'active', 'suspended', 'archived'), NOT boolean
 * - Array fields with size constraints: categories (max 2), cuisines (max 3)
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Create a new establishment in the database
 * 
 * This function inserts a new establishment with 'draft' status, allowing
 * partners to build their listing incrementally before submission.
 * 
 * @param {Object} establishmentData - The establishment data to insert
 * @param {string} establishmentData.partner_id - UUID of the partner creating the establishment
 * @param {string} establishmentData.name - Establishment name (1-255 characters)
 * @param {string} establishmentData.description - Optional description (max 2000 characters)
 * @param {string} establishmentData.city - City from valid enum (Минск, Гродно, etc.)
 * @param {string} establishmentData.address - Full street address
 * @param {number} establishmentData.latitude - Latitude coordinate (51.0-56.0 for Belarus)
 * @param {number} establishmentData.longitude - Longitude coordinate (23.0-33.0 for Belarus)
 * @param {string} establishmentData.phone - Optional phone number
 * @param {string} establishmentData.email - Optional email address
 * @param {string} establishmentData.website - Optional website URL
 * @param {Array<string>} establishmentData.categories - Array of categories (1-2 items)
 * @param {Array<string>} establishmentData.cuisines - Array of cuisine types (1-3 items)
 * @param {string} establishmentData.price_range - Optional price range ('$', '$$', '$$$')
 * @param {Object} establishmentData.working_hours - JSONB object with daily hours
 * @param {Object} establishmentData.special_hours - Optional JSONB for special hours
 * @param {Object} establishmentData.attributes - Optional JSONB for establishment attributes
 * @returns {Promise<Object>} The created establishment with all database fields
 * @throws {Error} If database operation fails
 */
export const createEstablishment = async (establishmentData) => {
  const {
    partner_id,
    name,
    description,
    city,
    address,
    latitude,
    longitude,
    phone,
    email,
    website,
    categories,
    cuisines,
    price_range,
    working_hours,
    special_hours,
    attributes,
    primary_image_url,
  } = establishmentData;

  const query = `
    INSERT INTO establishments (
      partner_id,
      name,
      description,
      city,
      address,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories,
      cuisines,
      price_range,
      working_hours,
      special_hours,
      attributes,
      primary_image_url,
      status,
      subscription_tier,
      base_score,
      boost_score,
      view_count,
      favorite_count,
      review_count,
      average_rating
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'draft', 'free', 0, 0, 0, 0, 0, 0.0)
    RETURNING 
      id,
      partner_id,
      name,
      description,
      city,
      address,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories,
      cuisines,
      price_range,
      working_hours,
      special_hours,
      attributes,
      status,
      subscription_tier,
      subscription_started_at,
      subscription_expires_at,
      base_score,
      boost_score,
      view_count,
      favorite_count,
      review_count,
      average_rating,
      primary_image_url,
      created_at,
      updated_at,
      published_at
  `;

  const values = [
    partner_id,
    name,
    description,
    city,
    address,
    latitude,
    longitude,
    phone,
    email,
    website,
    categories,
    cuisines,
    price_range,
    working_hours ? JSON.stringify(working_hours) : JSON.stringify({}), // Convert object to JSONB, default to empty object
    special_hours ? JSON.stringify(special_hours) : null,
    attributes ? JSON.stringify(attributes) : '{}',
    primary_image_url || null,
  ];

  try {
    const result = await pool.query(query, values);
    
    logger.info('Establishment created', {
      establishmentId: result.rows[0].id,
      partnerId: partner_id,
      name,
      city,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error creating establishment', {
      error: error.message,
      partnerId: partner_id,
      name,
    });
    throw error;
  }
};

/**
 * Find an establishment by its ID
 * 
 * @param {string} establishmentId - UUID of the establishment to find
 * @param {boolean} includeAll - Whether to include all statuses (default: false, only active)
 * @returns {Promise<Object|null>} The establishment object or null if not found
 */
export const findEstablishmentById = async (establishmentId, includeAll = false) => {
  const query = `
    SELECT 
      id,
      partner_id,
      name,
      description,
      city,
      address,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories,
      cuisines,
      price_range,
      working_hours,
      special_hours,
      attributes,
      status,
      moderation_notes,
      moderated_by,
      moderated_at,
      subscription_tier,
      subscription_started_at,
      subscription_expires_at,
      base_score,
      boost_score,
      view_count,
      favorite_count,
      review_count,
      average_rating,
      created_at,
      updated_at,
      published_at
    FROM establishments
    WHERE id = $1
    ${includeAll ? '' : "AND status NOT IN ('archived')"}
  `;

  try {
    const result = await pool.query(query, [establishmentId]);

    if (result.rows.length === 0) {
      return null;
    }

    logger.debug('Establishment found', {
      establishmentId,
      status: result.rows[0].status,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error finding establishment', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Get all establishments for a specific partner
 * 
 * This query supports pagination and filtering by status for the partner dashboard.
 * Results are ordered by creation date (newest first).
 * 
 * @param {string} partnerId - UUID of the partner
 * @param {Object} filters - Filter options
 * @param {string} filters.status - Optional status filter ('draft', 'pending', 'active', 'suspended')
 * @param {number} filters.limit - Maximum number of results (default: 20)
 * @param {number} filters.offset - Number of results to skip for pagination (default: 0)
 * @returns {Promise<Array>} Array of establishment objects with basic media
 */
export const getEstablishmentsByPartner = async (partnerId, filters = {}) => {
  const {
    status,
    limit = 20,
    offset = 0,
  } = filters;

  // Build dynamic WHERE clause based on filters
  const conditions = ['partner_id = $1'];
  const values = [partnerId];
  let paramCount = 2;

  if (status) {
    conditions.push(`status = $${paramCount}`);
    values.push(status);
    paramCount++;
  }

  // Add pagination parameters
  values.push(limit, offset);

  const query = `
    SELECT 
      e.id,
      e.partner_id,
      e.name,
      e.description,
      e.city,
      e.address,
      e.latitude,
      e.longitude,
      e.phone,
      e.email,
      e.website,
      e.categories,
      e.cuisines,
      e.price_range,
      e.status,
      e.subscription_tier,
      e.subscription_started_at,
      e.subscription_expires_at,
      e.view_count,
      e.favorite_count,
      e.review_count,
      e.average_rating,
      e.created_at,
      e.updated_at,
      e.published_at,
      e.moderation_notes,
      (
        SELECT json_build_object(
          'url', url,
          'thumbnail_url', thumbnail_url
        )
        FROM establishment_media
        WHERE establishment_id = e.id
          AND is_primary = true
        LIMIT 1
      ) as primary_photo
    FROM establishments e
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  try {
    const result = await pool.query(query, values);

    logger.debug('Fetched partner establishments', {
      partnerId,
      count: result.rows.length,
      status: status || 'all',
      limit,
      offset,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching partner establishments', {
      error: error.message,
      partnerId,
    });
    throw error;
  }
};

/**
 * Count total establishments for a partner
 * 
 * Used for pagination metadata. Can be filtered by status.
 * 
 * @param {string} partnerId - UUID of the partner
 * @param {string} status - Optional status filter
 * @returns {Promise<number>} Total count of establishments
 */
export const countPartnerEstablishments = async (partnerId, status = null) => {
  const conditions = ['partner_id = $1'];
  const values = [partnerId];

  if (status) {
    conditions.push('status = $2');
    values.push(status);
  }

  const query = `
    SELECT COUNT(*) as total
    FROM establishments
    WHERE ${conditions.join(' AND ')}
  `;

  try {
    const result = await pool.query(query, values);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting partner establishments', {
      error: error.message,
      partnerId,
    });
    throw error;
  }
};

/**
 * Update an establishment's information
 * 
 * This function builds a dynamic UPDATE query based on which fields are provided.
 * It always updates the updated_at timestamp.
 * 
 * @param {string} establishmentId - UUID of the establishment to update
 * @param {Object} updates - Object containing fields to update
 * @returns {Promise<Object>} The updated establishment object
 * @throws {Error} If establishment not found or database operation fails
 */
export const updateEstablishment = async (establishmentId, updates) => {
  const fields = [];
  const values = [];
  let paramCount = 1;

  // Build dynamic UPDATE query based on provided fields
  if (updates.name !== undefined) {
    fields.push(`name = $${paramCount}`);
    values.push(updates.name);
    paramCount++;
  }

  if (updates.description !== undefined) {
    fields.push(`description = $${paramCount}`);
    values.push(updates.description);
    paramCount++;
  }

  if (updates.address !== undefined) {
    fields.push(`address = $${paramCount}`);
    values.push(updates.address);
    paramCount++;
  }

  if (updates.city !== undefined) {
    fields.push(`city = $${paramCount}`);
    values.push(updates.city);
    paramCount++;
  }

  if (updates.latitude !== undefined) {
    fields.push(`latitude = $${paramCount}`);
    values.push(updates.latitude);
    paramCount++;
  }

  if (updates.longitude !== undefined) {
    fields.push(`longitude = $${paramCount}`);
    values.push(updates.longitude);
    paramCount++;
  }

  if (updates.phone !== undefined) {
    fields.push(`phone = $${paramCount}`);
    values.push(updates.phone);
    paramCount++;
  }

  if (updates.email !== undefined) {
    fields.push(`email = $${paramCount}`);
    values.push(updates.email);
    paramCount++;
  }

  if (updates.website !== undefined) {
    fields.push(`website = $${paramCount}`);
    values.push(updates.website);
    paramCount++;
  }

  if (updates.categories !== undefined) {
    fields.push(`categories = $${paramCount}`);
    values.push(updates.categories);
    paramCount++;
  }

  if (updates.cuisines !== undefined) {
    fields.push(`cuisines = $${paramCount}`);
    values.push(updates.cuisines);
    paramCount++;
  }

  if (updates.price_range !== undefined) {
    fields.push(`price_range = $${paramCount}`);
    values.push(updates.price_range);
    paramCount++;
  }

  if (updates.working_hours !== undefined) {
    fields.push(`working_hours = $${paramCount}`);
    values.push(JSON.stringify(updates.working_hours));
    paramCount++;
  }

  if (updates.special_hours !== undefined) {
    fields.push(`special_hours = $${paramCount}`);
    values.push(updates.special_hours ? JSON.stringify(updates.special_hours) : null);
    paramCount++;
  }

  if (updates.attributes !== undefined) {
    fields.push(`attributes = $${paramCount}`);
    values.push(JSON.stringify(updates.attributes));
    paramCount++;
  }

  if (updates.status !== undefined) {
    fields.push(`status = $${paramCount}`);
    values.push(updates.status);
    paramCount++;
  }

  // Always update updated_at timestamp
  fields.push('updated_at = CURRENT_TIMESTAMP');

  // Add establishmentId as the last parameter
  values.push(establishmentId);

  const query = `
    UPDATE establishments
    SET ${fields.join(', ')}
    WHERE id = $${paramCount}
    RETURNING 
      id,
      partner_id,
      name,
      description,
      city,
      address,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories,
      cuisines,
      price_range,
      working_hours,
      special_hours,
      attributes,
      status,
      moderation_notes,
      moderated_by,
      moderated_at,
      subscription_tier,
      subscription_started_at,
      subscription_expires_at,
      base_score,
      boost_score,
      view_count,
      favorite_count,
      review_count,
      average_rating,
      created_at,
      updated_at,
      published_at
  `;

  try {
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Establishment not found');
    }

    logger.info('Establishment updated', {
      establishmentId,
      updatedFields: Object.keys(updates),
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error updating establishment', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Submit establishment for moderation (change status from draft/rejected to pending)
 *
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<Object>} Updated establishment object
 * @throws {Error} If establishment not found or database operation fails
 */
export const submitForModeration = async (establishmentId) => {
  const query = `
    UPDATE establishments
    SET
      status = 'pending',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status IN ('draft', 'rejected')
    RETURNING
      id,
      partner_id,
      name,
      status,
      created_at,
      updated_at
  `;

  try {
    const result = await pool.query(query, [establishmentId]);

    if (result.rows.length === 0) {
      throw new Error('Establishment not found or not in draft/rejected status');
    }

    logger.info('Establishment submitted for moderation', {
      establishmentId,
      partnerId: result.rows[0].partner_id,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error submitting establishment for moderation', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Check if an establishment belongs to a specific partner
 * 
 * This is used for authorization to ensure partners can only modify
 * their own establishments.
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the partner
 * @returns {Promise<boolean>} True if establishment belongs to partner
 */
export const checkOwnership = async (establishmentId, partnerId) => {
  const query = `
    SELECT EXISTS(
      SELECT 1
      FROM establishments
      WHERE id = $1 AND partner_id = $2
    ) as is_owner
  `;

  try {
    const result = await pool.query(query, [establishmentId, partnerId]);
    return result.rows[0].is_owner;
  } catch (error) {
    logger.error('Error checking establishment ownership', {
      error: error.message,
      establishmentId,
      partnerId,
    });
    throw error;
  }
};

/**
 * Check if a partner already has an establishment with the given name
 * 
 * Used to prevent duplicate establishment names for the same partner.
 * 
 * @param {string} partnerId - UUID of the partner
 * @param {string} name - Establishment name to check
 * @param {string} excludeId - Optional establishment ID to exclude (for updates)
 * @returns {Promise<boolean>} True if name is already used
 */
/**
 * Increment the view count for an establishment
 *
 * Called when a public user views the establishment detail page.
 * Uses atomic increment to avoid race conditions.
 *
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<void>}
 */
export const incrementViewCount = async (establishmentId) => {
  const query = `
    UPDATE establishments
    SET view_count = view_count + 1
    WHERE id = $1
  `;

  try {
    await pool.query(query, [establishmentId]);
    logger.debug('View count incremented', { establishmentId });
  } catch (error) {
    // Non-critical: log but don't throw to avoid breaking the detail endpoint
    logger.error('Error incrementing view count', {
      error: error.message,
      establishmentId,
    });
  }
};

// ============================================================================
// Admin Moderation Queries
// ============================================================================

/**
 * Get paginated list of establishments with status 'pending'
 * Sorted by updated_at ASC (FIFO — oldest first)
 *
 * @param {number} limit - Max items per page
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of pending establishment objects with thumbnail
 */
export const getPendingEstablishments = async (limit = 20, offset = 0) => {
  const query = `
    SELECT
      e.id,
      e.name,
      e.city,
      e.categories,
      e.cuisines,
      e.phone,
      e.email,
      e.updated_at,
      e.created_at,
      (
        SELECT json_build_object(
          'url', em.url,
          'thumbnail_url', em.thumbnail_url
        )
        FROM establishment_media em
        WHERE em.establishment_id = e.id
          AND em.is_primary = true
        LIMIT 1
      ) as primary_photo
    FROM establishments e
    WHERE e.status = 'pending'
    ORDER BY e.updated_at ASC
    LIMIT $1 OFFSET $2
  `;

  try {
    const result = await pool.query(query, [limit, offset]);

    logger.debug('Fetched pending establishments', {
      count: result.rows.length,
      limit,
      offset,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching pending establishments', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Count total establishments with status 'pending'
 *
 * @returns {Promise<number>} Total count
 */
export const countPendingEstablishments = async () => {
  const query = `
    SELECT COUNT(*) as total
    FROM establishments
    WHERE status = 'pending'
  `;

  try {
    const result = await pool.query(query);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting pending establishments', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Execute moderation action on an establishment (approve or reject)
 * Updates status, moderation fields, and published_at (on approve)
 *
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} moderationData
 * @param {string} moderationData.status - New status ('active' or 'draft')
 * @param {string} moderationData.moderated_by - Admin user UUID
 * @param {Object} moderationData.moderation_notes - Per-field notes JSON
 * @param {boolean} moderationData.setPublishedAt - Whether to set published_at
 * @returns {Promise<Object>} Updated establishment
 */
export const moderateEstablishment = async (establishmentId, moderationData) => {
  const { status, moderated_by, moderation_notes, setPublishedAt } = moderationData;

  const publishedClause = setPublishedAt
    ? ', published_at = CURRENT_TIMESTAMP'
    : '';

  const query = `
    UPDATE establishments
    SET
      status = $1,
      moderated_by = $2,
      moderated_at = CURRENT_TIMESTAMP,
      moderation_notes = $3,
      updated_at = CURRENT_TIMESTAMP
      ${publishedClause}
    WHERE id = $4
      AND status = 'pending'
    RETURNING
      id,
      partner_id,
      name,
      status,
      moderated_by,
      moderated_at,
      moderation_notes,
      published_at,
      updated_at
  `;

  const values = [
    status,
    moderated_by,
    JSON.stringify(moderation_notes || {}),
    establishmentId,
  ];

  try {
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    logger.info('Establishment moderated', {
      establishmentId,
      newStatus: status,
      moderatedBy: moderated_by,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error moderating establishment', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

// ============================================================================
// Admin Content Management Queries (Segment C)
// ============================================================================

/**
 * Get paginated list of active (approved) establishments
 * Supports sorting, city filter, and name search
 *
 * @param {number} limit - Max items per page
 * @param {number} offset - Pagination offset
 * @param {Object} filters
 * @param {string} filters.sort - Sort order: 'newest', 'oldest', 'rating', 'views'
 * @param {string} filters.city - City filter
 * @param {string} filters.search - Name search (ILIKE)
 * @returns {Promise<Array>} Array of active establishment objects
 */
export const getActiveEstablishments = async (limit = 20, offset = 0, filters = {}) => {
  const { sort = 'newest', city, search } = filters;
  const conditions = ["e.status = 'active'"];
  const values = [];
  let paramCount = 1;

  if (city) {
    conditions.push(`e.city = $${paramCount}`);
    values.push(city);
    paramCount++;
  }

  if (search) {
    conditions.push(`e.name ILIKE $${paramCount}`);
    values.push(`%${search}%`);
    paramCount++;
  }

  // Determine ORDER BY clause
  const sortMap = {
    newest: 'e.published_at DESC NULLS LAST',
    oldest: 'e.published_at ASC NULLS LAST',
    rating: 'e.average_rating DESC, e.review_count DESC',
    views: 'e.view_count DESC',
  };
  const orderBy = sortMap[sort] || sortMap.newest;

  values.push(limit, offset);

  const query = `
    SELECT
      e.id,
      e.name,
      e.city,
      e.categories,
      e.cuisines,
      e.published_at,
      e.view_count,
      e.favorite_count,
      e.review_count,
      e.average_rating,
      e.subscription_tier,
      (
        SELECT json_build_object(
          'url', em.url,
          'thumbnail_url', em.thumbnail_url
        )
        FROM establishment_media em
        WHERE em.establishment_id = e.id
          AND em.is_primary = true
        LIMIT 1
      ) as primary_photo
    FROM establishments e
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  try {
    const result = await pool.query(query, values);

    logger.debug('Fetched active establishments', {
      count: result.rows.length,
      sort,
      city: city || 'all',
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching active establishments', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Count active establishments (for pagination)
 *
 * @param {Object} filters
 * @param {string} filters.city - City filter
 * @param {string} filters.search - Name search (ILIKE)
 * @returns {Promise<number>} Total count
 */
export const countActiveEstablishments = async (filters = {}) => {
  const { city, search } = filters;
  const conditions = ["status = 'active'"];
  const values = [];
  let paramCount = 1;

  if (city) {
    conditions.push(`city = $${paramCount}`);
    values.push(city);
    paramCount++;
  }

  if (search) {
    conditions.push(`name ILIKE $${paramCount}`);
    values.push(`%${search}%`);
    paramCount++;
  }

  const query = `
    SELECT COUNT(*) as total
    FROM establishments
    WHERE ${conditions.join(' AND ')}
  `;

  try {
    const result = await pool.query(query, values);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting active establishments', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Search establishments across ALL statuses
 *
 * @param {string} search - Name search (ILIKE, required)
 * @param {Object} filters
 * @param {string} filters.status - Optional status filter
 * @param {string} filters.city - Optional city filter
 * @param {number} filters.limit - Max items per page
 * @param {number} filters.offset - Pagination offset
 * @returns {Promise<Array>} Array of establishment objects with status
 */
export const searchAllEstablishments = async (search, filters = {}) => {
  const { status, city, limit = 20, offset = 0 } = filters;
  const conditions = [];
  const values = [];
  let paramCount = 1;

  // Required search parameter
  conditions.push(`e.name ILIKE $${paramCount}`);
  values.push(`%${search}%`);
  paramCount++;

  if (status) {
    conditions.push(`e.status = $${paramCount}`);
    values.push(status);
    paramCount++;
  }

  if (city) {
    conditions.push(`e.city = $${paramCount}`);
    values.push(city);
    paramCount++;
  }

  values.push(limit, offset);

  const query = `
    SELECT
      e.id,
      e.name,
      e.city,
      e.status,
      e.categories,
      e.cuisines,
      e.phone,
      e.email,
      e.published_at,
      e.created_at,
      e.view_count,
      e.favorite_count,
      e.review_count,
      e.average_rating,
      (
        SELECT json_build_object(
          'url', em.url,
          'thumbnail_url', em.thumbnail_url
        )
        FROM establishment_media em
        WHERE em.establishment_id = e.id
          AND em.is_primary = true
        LIMIT 1
      ) as primary_photo
    FROM establishments e
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.updated_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  try {
    const result = await pool.query(query, values);

    logger.debug('Search establishments', {
      search,
      count: result.rows.length,
      status: status || 'all',
    });

    return result.rows;
  } catch (error) {
    logger.error('Error searching establishments', {
      error: error.message,
      search,
    });
    throw error;
  }
};

/**
 * Count search results across all statuses (for pagination)
 *
 * @param {string} search - Name search (ILIKE, required)
 * @param {Object} filters
 * @param {string} filters.status - Optional status filter
 * @param {string} filters.city - Optional city filter
 * @returns {Promise<number>} Total count
 */
export const countSearchResults = async (search, filters = {}) => {
  const { status, city } = filters;
  const conditions = [];
  const values = [];
  let paramCount = 1;

  conditions.push(`name ILIKE $${paramCount}`);
  values.push(`%${search}%`);
  paramCount++;

  if (status) {
    conditions.push(`status = $${paramCount}`);
    values.push(status);
    paramCount++;
  }

  if (city) {
    conditions.push(`city = $${paramCount}`);
    values.push(city);
    paramCount++;
  }

  const query = `
    SELECT COUNT(*) as total
    FROM establishments
    WHERE ${conditions.join(' AND ')}
  `;

  try {
    const result = await pool.query(query, values);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting search results', {
      error: error.message,
      search,
    });
    throw error;
  }
};

/**
 * Change establishment status with validation of current state
 * Used for suspend (active → suspended) and unsuspend (suspended → active)
 *
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} params
 * @param {string} params.fromStatus - Required current status
 * @param {string} params.toStatus - Target status
 * @param {Object} params.moderationNotes - Optional moderation notes update
 * @returns {Promise<Object|null>} Updated establishment or null if status mismatch
 */
export const changeEstablishmentStatus = async (establishmentId, { fromStatus, toStatus, moderationNotes }) => {
  const values = [toStatus];
  let paramCount = 2;
  let notesClause = '';

  if (moderationNotes !== undefined) {
    notesClause = `, moderation_notes = $${paramCount}`;
    values.push(JSON.stringify(moderationNotes));
    paramCount++;
  }

  values.push(establishmentId, fromStatus);
  // establishmentId is at values.length - 1 (1-based), fromStatus at values.length
  const idParam = values.length - 1;
  const statusParam = values.length;

  const query = `
    UPDATE establishments
    SET
      status = $1,
      updated_at = CURRENT_TIMESTAMP
      ${notesClause}
    WHERE id = $${idParam}
      AND status = $${statusParam}
    RETURNING
      id,
      partner_id,
      name,
      status,
      moderation_notes,
      published_at,
      updated_at
  `;

  try {
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    logger.info('Establishment status changed', {
      establishmentId,
      from: fromStatus,
      to: toStatus,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error changing establishment status', {
      error: error.message,
      establishmentId,
      fromStatus,
      toStatus,
    });
    throw error;
  }
};

export const checkDuplicateName = async (partnerId, name, excludeId = null) => {
  const conditions = ['partner_id = $1', 'LOWER(name) = LOWER($2)'];
  const values = [partnerId, name];

  if (excludeId) {
    conditions.push('id != $3');
    values.push(excludeId);
  }

  const query = `
    SELECT EXISTS(
      SELECT 1
      FROM establishments
      WHERE ${conditions.join(' AND ')}
    ) as is_duplicate
  `;

  try {
    const result = await pool.query(query, values);
    return result.rows[0].is_duplicate;
  } catch (error) {
    logger.error('Error checking duplicate establishment name', {
      error: error.message,
      partnerId,
      name,
    });
    throw error;
  }
};

/**
 * Delete an establishment and its associated media records
 *
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the partner (for ownership check)
 * @returns {Promise<Object|null>} Deleted establishment basic info, or null if not found/not owned
 */
export const deleteEstablishment = async (establishmentId, partnerId) => {
  const query = `
    DELETE FROM establishments
    WHERE id = $1 AND partner_id = $2
    RETURNING id, name
  `;

  try {
    const result = await pool.query(query, [establishmentId, partnerId]);

    if (result.rows.length === 0) {
      return null;
    }

    logger.info('Establishment deleted', {
      establishmentId,
      partnerId,
      name: result.rows[0].name,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error deleting establishment', {
      error: error.message,
      establishmentId,
      partnerId,
    });
    throw error;
  }
};

// =============================================================================
// Suspended establishments (Admin — Приостановленные tab)
// =============================================================================

/**
 * Fetch suspended establishments for admin listing
 *
 * Returns establishments with status 'suspended', ordered by most recently
 * suspended (updated_at DESC). Includes moderation_notes for suspend_reason.
 *
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>} Suspended establishments
 */
export const getSuspendedEstablishments = async (limit = 20, offset = 0) => {
  const query = `
    SELECT
      e.id,
      e.name,
      e.city,
      e.categories,
      e.cuisines,
      e.moderation_notes,
      e.updated_at,
      e.created_at,
      (
        SELECT json_build_object(
          'url', em.url,
          'thumbnail_url', em.thumbnail_url
        )
        FROM establishment_media em
        WHERE em.establishment_id = e.id
          AND em.is_primary = true
        LIMIT 1
      ) as primary_photo
    FROM establishments e
    WHERE e.status = 'suspended'
    ORDER BY e.updated_at DESC
    LIMIT $1 OFFSET $2
  `;

  try {
    const result = await pool.query(query, [limit, offset]);

    logger.debug('Fetched suspended establishments', {
      count: result.rows.length,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching suspended establishments', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Count suspended establishments (for pagination)
 *
 * @returns {Promise<number>} Total count
 */
export const countSuspendedEstablishments = async () => {
  const query = `
    SELECT COUNT(*) as total
    FROM establishments
    WHERE status = 'suspended'
  `;

  try {
    const result = await pool.query(query);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting suspended establishments', {
      error: error.message,
    });
    throw error;
  }
};

