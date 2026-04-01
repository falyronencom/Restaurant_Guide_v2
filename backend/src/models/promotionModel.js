/**
 * Promotion Model
 *
 * Database access methods for the promotions table.
 * Follows patterns from establishmentModel.js and mediaModel.js.
 *
 * Table: promotions
 * Key fields: id, establishment_id, title, description, image_url,
 *   thumbnail_url, preview_url, valid_from, valid_until, status, position
 *
 * Status values: 'active', 'expired', 'hidden_by_admin'
 * Lazy expiry: deactivateExpired() called before read operations
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Maximum active promotions per establishment (Phase 1: free for all partners).
 */
const MAX_ACTIVE_PROMOTIONS = 3;

/**
 * Lazy expiry — mark promotions as 'expired' where valid_until < NOW().
 * Called before read operations to ensure stale promotions don't appear as active.
 * Skips promotions with valid_until IS NULL (indefinite).
 *
 * @param {string} establishmentId - UUID (optional, scoped to one establishment)
 */
export const deactivateExpired = async (establishmentId = null) => {
  try {
    const query = establishmentId
      ? `UPDATE promotions SET status = 'expired', updated_at = NOW()
         WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE
         AND establishment_id = $1`
      : `UPDATE promotions SET status = 'expired', updated_at = NOW()
         WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE`;

    const params = establishmentId ? [establishmentId] : [];
    const result = await pool.query(query, params);

    if (result.rowCount > 0) {
      logger.info('Lazy expiry: deactivated expired promotions', {
        count: result.rowCount,
        establishmentId,
      });
    }
  } catch (error) {
    logger.error('Error in lazy expiry of promotions', {
      error: error.message,
      establishmentId,
    });
  }
};

/**
 * Get count of active promotions for an establishment.
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<number>} Count of active promotions
 */
export const getActiveCount = async (establishmentId) => {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM promotions
     WHERE establishment_id = $1 AND status = 'active'`,
    [establishmentId],
  );
  return parseInt(result.rows[0].count);
};

/**
 * Create a new promotion.
 * Caller must verify active count < MAX_ACTIVE_PROMOTIONS before calling.
 *
 * @param {Object} data - Promotion data
 * @returns {Promise<Object>} Created promotion row
 */
export const createPromotion = async (data) => {
  const {
    establishment_id,
    title,
    description = null,
    terms_and_conditions = null,
    image_url = null,
    thumbnail_url = null,
    preview_url = null,
    valid_from = null,
    valid_until = null,
    position = 0,
  } = data;

  const query = `
    INSERT INTO promotions (
      establishment_id, title, description, terms_and_conditions,
      image_url, thumbnail_url, preview_url,
      valid_from, valid_until, position, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE), $9, $10, 'active')
    RETURNING *
  `;

  const result = await pool.query(query, [
    establishment_id, title, description, terms_and_conditions,
    image_url, thumbnail_url, preview_url,
    valid_from, valid_until, position,
  ]);

  return result.rows[0];
};

/**
 * Get promotions for an establishment.
 *
 * @param {string} establishmentId - UUID
 * @param {boolean} includeInactive - If true, return all statuses (partner view)
 * @returns {Promise<Object[]>} Promotion rows
 */
export const getPromotionsByEstablishment = async (establishmentId, includeInactive = false) => {
  // Lazy expiry before reading
  await deactivateExpired(establishmentId);

  const query = includeInactive
    ? `SELECT * FROM promotions
       WHERE establishment_id = $1
       ORDER BY status = 'active' DESC, position ASC, created_at DESC`
    : `SELECT * FROM promotions
       WHERE establishment_id = $1 AND status = 'active'
       ORDER BY position ASC, created_at DESC`;

  const result = await pool.query(query, [establishmentId]);
  return result.rows;
};

/**
 * Get a single promotion by ID.
 *
 * @param {string} id - Promotion UUID
 * @returns {Promise<Object|null>} Promotion row or null
 */
export const getPromotionById = async (id) => {
  const result = await pool.query(
    'SELECT * FROM promotions WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
};

/**
 * Update a promotion.
 *
 * @param {string} id - Promotion UUID
 * @param {Object} data - Fields to update
 * @returns {Promise<Object>} Updated promotion row
 */
export const updatePromotion = async (id, data) => {
  const allowedFields = [
    'title', 'description', 'terms_and_conditions',
    'image_url', 'thumbnail_url', 'preview_url',
    'valid_from', 'valid_until', 'position',
  ];

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      setClauses.push(`${field} = $${paramIndex}`);
      values.push(data[field]);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return getPromotionById(id);
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  const query = `
    UPDATE promotions
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
};

/**
 * Deactivate a single promotion (soft delete → status='expired').
 *
 * @param {string} id - Promotion UUID
 * @returns {Promise<Object|null>} Updated promotion row
 */
export const deactivatePromotion = async (id) => {
  const result = await pool.query(
    `UPDATE promotions SET status = 'expired', updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
};

/**
 * Deactivate all active promotions for an establishment.
 * Used when subscription expires (future use).
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<number>} Number of deactivated promotions
 */
export const deactivateAllForEstablishment = async (establishmentId) => {
  const result = await pool.query(
    `UPDATE promotions SET status = 'expired', updated_at = NOW()
     WHERE establishment_id = $1 AND status = 'active'`,
    [establishmentId],
  );
  return result.rowCount;
};

/**
 * Batch fetch active promotions for multiple establishments.
 * Critical for search enrichment: one query for N establishments, not N queries.
 *
 * @param {string[]} establishmentIds - Array of UUIDs
 * @returns {Promise<Map<string, Object[]>>} Map of establishmentId → promotions[]
 */
export const getActivePromotionsForEstablishments = async (establishmentIds) => {
  if (!establishmentIds || establishmentIds.length === 0) {
    return new Map();
  }

  // Lazy expiry for all queried establishments in one shot
  await pool.query(
    `UPDATE promotions SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE
     AND establishment_id = ANY($1)`,
    [establishmentIds],
  );

  const result = await pool.query(
    `SELECT * FROM promotions
     WHERE establishment_id = ANY($1) AND status = 'active'
     ORDER BY position ASC, created_at DESC`,
    [establishmentIds],
  );

  // Group by establishment_id
  const map = new Map();
  for (const row of result.rows) {
    const id = row.establishment_id;
    if (!map.has(id)) {
      map.set(id, []);
    }
    map.get(id).push(row);
  }

  return map;
};

export { MAX_ACTIVE_PROMOTIONS };
