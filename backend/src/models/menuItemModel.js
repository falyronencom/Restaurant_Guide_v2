/**
 * Menu Item Model
 *
 * Parsed menu positions from OCR pipeline. Items are the output of
 * ocrService.processJob and the input for dish-based Smart Search in Segment B.
 *
 * Table: menu_items
 * Key design: establishment_id is denormalized from establishment_media for
 * direct JOIN in Smart Search without traversing the media table.
 *
 * Ownership: items belong to a specific media_id. Replacing the OCR result
 * for a media (re-run) happens via replaceForMedia in a single transaction
 * so search results never observe a partial state.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Fields writable via createMany / replaceForMedia.
 */
const WRITABLE_FIELDS = [
  'item_name',
  'price_byn',
  'category_raw',
  'confidence',
  'sanity_flag',
  'position',
];

/**
 * Build multi-row INSERT VALUES clause + params array.
 *
 * @param {Object[]} items - Items with fields from WRITABLE_FIELDS
 * @param {string} establishmentId - UUID
 * @param {string} mediaId - UUID
 * @returns {{ valuesClause: string, params: Array }} SQL fragment and params
 */
const buildBulkInsertFragment = (items, establishmentId, mediaId) => {
  const params = [];
  const valueRows = [];

  items.forEach((item, idx) => {
    const rowParams = [
      establishmentId,
      mediaId,
      item.item_name,
      item.price_byn ?? null,
      item.category_raw ?? null,
      item.confidence ?? null,
      item.sanity_flag ? JSON.stringify(item.sanity_flag) : null,
      item.position ?? idx,
    ];

    const base = params.length + 1;
    params.push(...rowParams);

    valueRows.push(
      `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, ` +
      `$${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7})`,
    );
  });

  return {
    valuesClause: valueRows.join(',\n  '),
    params,
  };
};

/**
 * Batch insert menu items. All items belong to a single establishment and media.
 *
 * Uses a single multi-row INSERT for efficiency. For very large batches (>1000 items),
 * consider splitting, but realistic menus have 20-200 items.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.mediaId - UUID
 * @param {Object[]} params.items - Items to insert
 * @returns {Promise<Object[]>} Inserted rows with generated IDs
 */
export const createMany = async ({ establishmentId, mediaId, items }) => {
  if (!items || items.length === 0) {
    return [];
  }

  const { valuesClause, params } = buildBulkInsertFragment(items, establishmentId, mediaId);

  const query = `
    INSERT INTO menu_items (
      establishment_id, media_id, item_name, price_byn,
      category_raw, confidence, sanity_flag, position
    )
    VALUES ${valuesClause}
    RETURNING *
  `;

  const result = await pool.query(query, params);
  return result.rows;
};

/**
 * Delete all menu items associated with a media file.
 * Used when a PDF is replaced or OCR is re-run from scratch.
 *
 * @param {string} mediaId - UUID
 * @returns {Promise<number>} Number of deleted rows
 */
export const deleteByMediaId = async (mediaId) => {
  const result = await pool.query(
    'DELETE FROM menu_items WHERE media_id = $1',
    [mediaId],
  );
  return result.rowCount;
};

/**
 * Get all menu items for an establishment.
 *
 * @param {string} establishmentId - UUID
 * @param {Object} options
 * @param {boolean} options.includeHidden - If true, include items hidden by admin (admin/partner view)
 * @returns {Promise<Object[]>} Menu items ordered by position
 */
export const getByEstablishmentId = async (establishmentId, { includeHidden = false } = {}) => {
  const query = includeHidden
    ? `SELECT * FROM menu_items
       WHERE establishment_id = $1
       ORDER BY position ASC, item_name ASC`
    : `SELECT * FROM menu_items
       WHERE establishment_id = $1 AND is_hidden_by_admin = FALSE
       ORDER BY position ASC, item_name ASC`;

  const result = await pool.query(query, [establishmentId]);
  return result.rows;
};

/**
 * Find a single menu item by ID.
 *
 * @param {string} id - UUID
 * @returns {Promise<Object|null>} Item or null
 */
export const findById = async (id) => {
  const result = await pool.query(
    'SELECT * FROM menu_items WHERE id = $1',
    [id],
  );
  return result.rows[0] || null;
};

/**
 * Update specific fields of a menu item.
 * Used for inline editing (Segment B partner UI) and moderator hide/unhide (Segment B admin UI).
 *
 * @param {string} id - UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated row or null if not found
 */
export const updateById = async (id, updates) => {
  const allowedFields = [
    'item_name',
    'price_byn',
    'category_raw',
    'confidence',
    'sanity_flag',
    'is_hidden_by_admin',
    'hidden_reason',
    'position',
  ];

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      if (field === 'sanity_flag') {
        setClauses.push(`${field} = $${paramIndex}::jsonb`);
        values.push(updates[field] === null ? null : JSON.stringify(updates[field]));
      } else {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
      }
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return findById(id);
  }

  setClauses.push('updated_at = NOW()');
  values.push(id);

  const query = `
    UPDATE menu_items
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
};

/**
 * Atomically replace all menu items for a media file.
 *
 * Single transaction: SELECT previous items (for sanity comparison by caller) →
 * DELETE existing items for this media → INSERT new items.
 *
 * Search results will never observe a partial state because the whole replacement
 * is one transaction and the GIN trigram index is consistent on commit.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.mediaId - UUID
 * @param {Object[]} params.newItems - New items to insert
 * @returns {Promise<{previousItems: Object[], newItems: Object[]}>}
 *          previousItems for sanity check delta comparison; newItems with generated IDs
 */
export const replaceForMedia = async ({ establishmentId, mediaId, newItems }) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const prevResult = await client.query(
      'SELECT * FROM menu_items WHERE media_id = $1 ORDER BY position ASC',
      [mediaId],
    );
    const previousItems = prevResult.rows;

    await client.query('DELETE FROM menu_items WHERE media_id = $1', [mediaId]);

    let insertedItems = [];
    if (newItems && newItems.length > 0) {
      const { valuesClause, params } = buildBulkInsertFragment(newItems, establishmentId, mediaId);

      const insertQuery = `
        INSERT INTO menu_items (
          establishment_id, media_id, item_name, price_byn,
          category_raw, confidence, sanity_flag, position
        )
        VALUES ${valuesClause}
        RETURNING *
      `;

      const insertResult = await client.query(insertQuery, params);
      insertedItems = insertResult.rows;
    }

    await client.query('COMMIT');

    logger.info('Menu items replaced for media', {
      mediaId,
      establishmentId,
      previousCount: previousItems.length,
      newCount: insertedItems.length,
    });

    return {
      previousItems,
      newItems: insertedItems,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to replace menu items for media', {
      mediaId,
      error: error.message,
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * List items with a non-null sanity_flag, JOINed with parent establishment
 * (name, city, status) for the admin "Подозрительные позиции меню" dashboard.
 *
 * @param {Object} params
 * @param {number} [params.limit=20]
 * @param {number} [params.offset=0]
 * @param {string} [params.reason] - Optional filter on sanity_flag.reason
 * @returns {Promise<{items: Object[], total: number}>}
 */
export const getFlaggedItems = async ({ limit = 20, offset = 0, reason } = {}) => {
  const conditions = ['mi.sanity_flag IS NOT NULL'];
  const values = [];
  let paramIndex = 1;

  if (reason) {
    conditions.push(`mi.sanity_flag->>'reason' = $${paramIndex++}`);
    values.push(reason);
  }

  const whereClause = conditions.join(' AND ');

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM menu_items mi
    WHERE ${whereClause}
  `;

  const dataQuery = `
    SELECT
      mi.*,
      e.name         AS establishment_name,
      e.city         AS establishment_city,
      e.status       AS establishment_status,
      e.partner_id   AS establishment_partner_id
    FROM menu_items mi
    JOIN establishments e ON e.id = mi.establishment_id
    WHERE ${whereClause}
    ORDER BY mi.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, values),
    pool.query(dataQuery, [...values, limit, offset]),
  ]);

  return {
    items: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
  };
};

export { WRITABLE_FIELDS };
