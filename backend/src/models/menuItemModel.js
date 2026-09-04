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
import { CATALOGUE_TRACK_STATUSES } from '../constants/establishmentVocab.js';
import {
  cityCyrillicToSlug,
  citySlugToCyrillic,
  expandCityForQuery,
} from '../constants/urlSlugs.js';

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
 * Aggregate counts for the batch-level menu_parsed notification: how many
 * items the establishment's menu holds and how many menu files they came from.
 * Items hidden by admin are counted — they were recognised; moderation is a
 * separate concern.
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<{ items: number, files: number }>}
 */
export const countByEstablishment = async (establishmentId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS items, COUNT(DISTINCT media_id)::int AS files
     FROM menu_items
     WHERE establishment_id = $1`,
    [establishmentId],
  );
  const row = result.rows[0] || {};
  return { items: row.items ?? 0, files: row.files ?? 0 };
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
 * Visibility axis of the admin queue. `visible` mirrors the rail badge exactly;
 * `all` is the historical behaviour and stays the default so the endpoint's
 * contract does not change under callers that never pass the parameter.
 */
const VISIBILITY_MODES = Object.freeze(['all', 'visible', 'hidden']);

/**
 * Predicates shared by the three queries below.
 *
 * They are declared once and composed per query, because each query needs a
 * DIFFERENT subset and Postgres numbers placeholders positionally:
 *   - the page itself: everything;
 *   - the counters: everything EXCEPT visibility (both numbers come from one
 *     scan via FILTER, so they cannot disagree with each other);
 *   - the city list: everything EXCEPT the city (filtering cities by the chosen
 *     city would collapse the dropdown to the single option already selected).
 *
 * @param {Object} filters
 * @returns {{kind: string, sql: (i: number) => string, value?: *}[]}
 */
const flaggedFilters = ({ reason, visibility, city, search }) => {
  const filters = [
    // Same ESTABLISHMENT-STATUS scope as qualityHealthModel.getHangingFlags — see
    // CATALOGUE_TRACK_STATUSES. The rail badge is built from that function, so this
    // axis must not drift between the badge and the screen it links to.
    {
      kind: 'scope',
      sql: (i) => `e.status = ANY($${i}::varchar[])`,
      value: CATALOGUE_TRACK_STATUSES,
    },
  ];

  // The hidden axis used to differ permanently: getHangingFlags also requires
  // `is_hidden_by_admin = FALSE`, while the queue showed hidden items unconditionally
  // so they could be unhidden. Since hiding never clears sanity_flag, a badge of 12
  // opened onto 20 rows and the gap grew with every hide. It is now a parameter, and
  // `visibility='visible'` makes total and the badge equal by construction.
  if (visibility === 'visible') {
    filters.push({ kind: 'visibility', sql: () => 'mi.is_hidden_by_admin = FALSE' });
  } else if (visibility === 'hidden') {
    filters.push({ kind: 'visibility', sql: () => 'mi.is_hidden_by_admin = TRUE' });
  }

  if (reason) {
    filters.push({
      kind: 'reason',
      sql: (i) => `mi.sanity_flag->>'reason' = $${i}`,
      value: reason,
    });
  }

  if (city) {
    // Both spellings of Могилёв live in the data (establishmentService allows either),
    // so an equality match would split one city in two: half the queue under each
    // spelling, and a total that under-reports without saying so. Same expansion the
    // public catalogue uses — see publicService.
    filters.push({
      kind: 'city',
      sql: (i) => `e.city = ANY($${i}::varchar[])`,
      value: expandCityForQuery(city),
    });
  }

  if (search) {
    // One placeholder, two references — the moderator searches by dish or by venue
    // without choosing which of the two the string is.
    filters.push({
      kind: 'search',
      sql: (i) => `(mi.item_name ILIKE $${i} ESCAPE '\\' OR e.name ILIKE $${i} ESCAPE '\\')`,
      value: `%${escapeLike(search)}%`,
    });
  }

  return filters;
};

/**
 * Neutralise LIKE wildcards inside user input.
 *
 * Without this a search for «100%» matches «1000 грамм», and a lone «%» returns the
 * whole queue while the field on screen claims to be filtering it.
 */
const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * One spelling per city for the filter dropdown.
 *
 * Могилев и Могилёв — один город и один фильтр (see expandCityForQuery), so offering
 * both would give two options that return the same rows.
 */
const canonicalCity = (city) => {
  const slug = cityCyrillicToSlug(city);
  return (slug && citySlugToCyrillic(slug)) || city;
};

/**
 * Compose a WHERE clause from the subset of filters whose kind is in `kinds`.
 * Valueless filters (visibility) contribute SQL without consuming a placeholder.
 */
const composeWhere = (filters, kinds) => {
  const values = [];
  const parts = ['mi.sanity_flag IS NOT NULL'];

  for (const filter of filters) {
    if (!kinds.includes(filter.kind)) continue;
    if (filter.value === undefined) {
      parts.push(filter.sql());
    } else {
      values.push(filter.value);
      parts.push(filter.sql(values.length));
    }
  }

  return { where: parts.join(' AND '), values };
};

/**
 * List items with a non-null sanity_flag, JOINed with parent establishment
 * (name, city, status, categories, cuisines) for the admin "Позиции меню" queue.
 *
 * All four filters are server-side: the queue paginates, and a client-side filter
 * over one page would answer a different question than the one it displays.
 *
 * @param {Object} params
 * @param {number} [params.limit=20]
 * @param {number} [params.offset=0]
 * @param {string} [params.reason] - Filter on sanity_flag.reason
 * @param {string} [params.visibility='all'] - all | visible | hidden
 * @param {string} [params.city] - Exact establishment city
 * @param {string} [params.search] - Substring of item name OR establishment name
 * @returns {Promise<{
 *   items: Object[],
 *   total: number,
 *   counts: {visible: number, hidden: number},
 *   cities: string[]
 * }>}
 */
export const getFlaggedItems = async ({
  limit = 20,
  offset = 0,
  reason,
  visibility = 'all',
  city,
  search,
} = {}) => {
  const filters = flaggedFilters({ reason, visibility, city, search });

  const page = composeWhere(filters, ['scope', 'visibility', 'reason', 'city', 'search']);
  const counts = composeWhere(filters, ['scope', 'reason', 'city', 'search']);
  const cityList = composeWhere(filters, ['scope', 'visibility', 'reason', 'search']);

  // Both counters ride ONE scan of the same population, so "shown" and "hidden" can
  // never contradict each other the way two independent COUNT queries could. The
  // visibility predicate is deliberately absent here — it is applied by picking the
  // number below, not by narrowing the scan.
  const countsQuery = `
    SELECT
      COUNT(*) FILTER (WHERE NOT mi.is_hidden_by_admin) AS visible_total,
      COUNT(*) FILTER (WHERE mi.is_hidden_by_admin)     AS hidden_total
    FROM menu_items mi
    JOIN establishments e ON e.id = mi.establishment_id
    WHERE ${counts.where}
  `;

  const citiesQuery = `
    SELECT DISTINCT e.city
    FROM menu_items mi
    JOIN establishments e ON e.id = mi.establishment_id
    WHERE ${cityList.where}
    ORDER BY e.city
  `;

  // Columns are listed explicitly rather than `mi.*`: created_at needs the UTC cast
  // below, and a duplicate column name in the projection would leave which one wins
  // to the driver.
  const dataQuery = `
    SELECT
      mi.id,
      mi.establishment_id,
      mi.media_id,
      mi.item_name,
      mi.price_byn,
      mi.category_raw,
      mi.confidence,
      mi.sanity_flag,
      mi.is_hidden_by_admin,
      mi.hidden_reason,
      -- AT TIME ZONE 'UTC' обязателен. Колонка — timestamp WITHOUT time zone,
      -- и node-pg читает такую метку как местное время СВОЕГО процесса: в проде
      -- (TZ=UTC) совпадает с хранимым, а на машине разработчика уезжает на его
      -- часовой пояс. «Распарсено 09:41» на экране модератора — это та же метка.
      mi.created_at AT TIME ZONE 'UTC' AS created_at,
      e.name         AS establishment_name,
      e.city         AS establishment_city,
      e.status       AS establishment_status,
      e.partner_id   AS establishment_partner_id,
      e.categories   AS establishment_categories,
      e.cuisines     AS establishment_cuisines
    FROM menu_items mi
    JOIN establishments e ON e.id = mi.establishment_id
    WHERE ${page.where}
    -- Ties are the norm here rather than the exception: every item of one parsed menu
    -- is inserted in a single transaction and shares the timestamp. Without further
    -- keys the sort is undefined between them, and a paginated queue would then show
    -- one row twice and skip another. Position first — inside one menu that is the
    -- order the dishes were read in; id last, because it alone is guaranteed unique.
    ORDER BY mi.created_at DESC, mi.position ASC, mi.id DESC
    LIMIT $${page.values.length + 1} OFFSET $${page.values.length + 2}
  `;

  const [countsResult, citiesResult, dataResult] = await Promise.all([
    pool.query(countsQuery, counts.values),
    pool.query(citiesQuery, cityList.values),
    pool.query(dataQuery, [...page.values, limit, offset]),
  ]);

  const visibleTotal = parseInt(countsResult.rows[0].visible_total, 10);
  const hiddenTotal = parseInt(countsResult.rows[0].hidden_total, 10);

  let total = visibleTotal + hiddenTotal;
  if (visibility === 'visible') total = visibleTotal;
  if (visibility === 'hidden') total = hiddenTotal;

  // One spelling per city, and the selected one always present: a filter whose own
  // value is missing from the option list reads on screen as "no filter applied".
  // That happens easily — pick Минск, switch to «Скрытые», and every Minsk row is
  // on the other side of the visibility predicate.
  const cities = [];
  for (const row of citiesResult.rows) {
    const name = canonicalCity(row.city);
    if (!cities.includes(name)) cities.push(name);
  }
  if (city) {
    const selected = canonicalCity(city);
    if (!cities.includes(selected)) cities.push(selected);
  }
  // Sorted here rather than left to the query: the line above appends, and a list
  // that is alphabetical except for one entry looks like a bug on the screen.
  cities.sort((a, b) => a.localeCompare(b, 'ru'));

  return {
    items: dataResult.rows,
    total,
    // BOTH halves of the population, whatever the chosen visibility. `total` alone
    // cannot answer "and how many are on the other side" — on the «Скрытые» tab it
    // IS the hidden count, and the rest of the queue would be unnameable.
    counts: { visible: visibleTotal, hidden: hiddenTotal },
    cities,
  };
};

export { WRITABLE_FIELDS, VISIBILITY_MODES };
