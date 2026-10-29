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
import { likeContains } from '../utils/likePattern.js';
import { dishKey } from '../utils/menuItemName.js';
import { findCopies } from '../projections/menuItemProjections.js';
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
 * @param {Object} [options]
 * @param {boolean} [options.withModeration=false] - Append is_hidden_by_admin
 *   and hidden_reason (replaceForMedia carries the moderator's decisions over;
 *   the INSERT column list must name both after position)
 * @returns {{ valuesClause: string, params: Array }} SQL fragment and params
 */
const buildBulkInsertFragment = (items, establishmentId, mediaId, { withModeration = false } = {}) => {
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
    if (withModeration) {
      rowParams.push(item.is_hidden_by_admin === true, item.hidden_reason ?? null);
    }

    const base = params.length + 1;
    params.push(...rowParams);

    const moderationParams = withModeration ? `, $${base + 8}, $${base + 9}` : '';
    valueRows.push(
      `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, ` +
      `$${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}${moderationParams})`,
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
 * Whether the establishment has items hidden by admin. The partner's menu
 * screen needs it to tell «the file was read and every dish hidden» from
 * «the file was read and nothing found» (finding КО-1, 29.10.2026): both
 * reach the partner as an empty list. Only the fact — no names, no count.
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<boolean>}
 */
export const hasHiddenByEstablishment = async (establishmentId) => {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM menu_items
       WHERE establishment_id = $1 AND is_hidden_by_admin = TRUE
     ) AS has_hidden`,
    [establishmentId],
  );
  return result.rows[0]?.has_hidden === true;
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
 * The moderator's «Скрыть» decisions, ready to be looked up by the rows of a
 * new read of a file.
 *
 * A decision travels with the dish name, read as two recognitions of one menu
 * may differ in it (utils/menuItemName.js dishKey). Where a name repeats across
 * sections («Чай» under «Напитки» hidden, under «Завтраки» shown), the row
 * with the same name AND section decides first, and a hidden one wins over a
 * shown one; failing that, a name that was hidden anywhere stays hidden — a
 * re-read must not show guests a dish the moderator took away, and an
 * over-hidden row is one click in the panel. Rows are walked in the order
 * given, so the reason carried is the one of the first hidden row.
 *
 * What the decisions are taken from is the caller's (replaceForMedia): the
 * rows of the file before the re-read — shown and hidden — and the dishes
 * hidden elsewhere in the establishment.
 *
 * @param {Object[]} previousItems - Rows with item_name, category_raw,
 *   is_hidden_by_admin, hidden_reason
 * @returns {{ bySection: Map<string, {hidden: boolean, reason: (string|null)}>,
 *             hiddenByName: Map<string, (string|null)> }}
 */
const collectModerationDecisions = (previousItems) => {
  const bySection = new Map();
  const hiddenByName = new Map();

  for (const item of previousItems) {
    if (!item.item_name) continue;
    const name = dishKey(item.item_name);
    const sectionKey = JSON.stringify([name, dishKey(item.category_raw)]);
    const hidden = item.is_hidden_by_admin === true;

    const known = bySection.get(sectionKey);
    if (!known || (hidden && !known.hidden)) {
      bySection.set(sectionKey, { hidden, reason: hidden ? item.hidden_reason : null });
    }
    if (hidden && !hiddenByName.has(name)) {
      hiddenByName.set(name, item.hidden_reason);
    }
  }

  return { bySection, hiddenByName };
};

/**
 * The decision a new row inherits (see collectModerationDecisions).
 *
 * @returns {{hidden: boolean, reason: (string|null)}}
 */
const inheritedDecision = (item, { bySection, hiddenByName }) => {
  if (!item.item_name) return { hidden: false, reason: null };
  const name = dishKey(item.item_name);

  const sameSection = bySection.get(JSON.stringify([name, dishKey(item.category_raw)]));
  if (sameSection) return sameSection;

  return hiddenByName.has(name)
    ? { hidden: true, reason: hiddenByName.get(name) }
    : { hidden: false, reason: null };
};

/**
 * The decision a file's own previous read holds for the row's name AND
 * section, or null. Inside a file the section decides first (rule of
 * 2026-10-07, kept by the Coordinator's word of 29.10.2026 with Trunk's
 * refinement «other files»): «Чай» under «Завтраки» the moderator left shown
 * next to the hidden «Чай» under «Напитки» stays shown at every re-read, even
 * though «Скрыть» hid «Чай» under «Завтраки» in the other files and the
 * establishment remembers it there (review of 29.10.2026, both reviewers).
 *
 * @returns {({hidden: boolean, reason: (string|null)}|null)}
 */
const ownSectionDecision = (item, { bySection }) => (item.item_name
  ? bySection.get(JSON.stringify([dishKey(item.item_name), dishKey(item.category_raw)])) ?? null
  : null);

/**
 * Whether migration 038 (the hidden dishes of an establishment, remembered
 * apart from the menu files) is applied. Migrations reach production by hand,
 * after the code: until then the code works without the table — the dish is
 * followed only into files whose hidden rows are still there — and never
 * answers 500 for it. Asked before a transaction: a failed statement inside
 * one would abort the whole of it.
 *
 * @param {Object} [db=pool] - pool or a connected client
 * @returns {Promise<boolean>}
 */
export const hiddenNamesTableExists = async (db = pool) => {
  const result = await db.query(
    "SELECT to_regclass('public.menu_item_hidden_names') IS NOT NULL AS present",
  );
  return result.rows[0]?.present === true;
};

/**
 * Serialize the writers of one establishment's menu decisions: a recognised
 * file being written (replaceForMedia) and the moderator's «Скрыть» and
 * «Показать снова». Without it a file read while «Скрыть» was clicked on
 * another file would miss the decision on both sides — the write took the
 * decisions before the click, the click scanned the rows before the write —
 * and the dish would stay on the card. Held to the end of the transaction.
 *
 * @param {Object} client - Connected client inside BEGIN
 * @param {string} establishmentId - UUID
 */
const lockEstablishmentMenu = (client, establishmentId) => client.query(
  'SELECT pg_advisory_xact_lock(hashtext($1))',
  [`menu_items:${establishmentId}`],
);

/**
 * The dishes hidden in the establishment outside one file: the hidden rows of
 * its other files, then the remembered dishes (migration 038), shaped as
 * hidden rows for collectModerationDecisions. A moderator's «Скрыть» follows
 * the dish into every other file of the establishment, the files uploaded
 * later included, and after the file it was hidden in is deleted (decision of
 * the Coordinator 29.10.2026, п. 3а, П1а).
 *
 * @param {Object} client - Connected client inside BEGIN
 * @param {string} establishmentId - UUID
 * @param {string} mediaId - UUID of the file being written
 * @param {boolean} withMemory - Migration 038 applied
 * @returns {Promise<Object[]>}
 */
const readHiddenElsewhere = async (client, establishmentId, mediaId, withMemory) => {
  const hiddenRows = await client.query(
    `SELECT item_name, category_raw, hidden_reason, TRUE AS is_hidden_by_admin
     FROM menu_items
     WHERE establishment_id = $1 AND media_id <> $2 AND is_hidden_by_admin = TRUE
     ORDER BY created_at ASC, position ASC, id ASC`,
    [establishmentId, mediaId],
  );
  if (!withMemory) return hiddenRows.rows;

  const remembered = await client.query(
    `SELECT item_name, category_raw, hidden_reason, TRUE AS is_hidden_by_admin
     FROM menu_item_hidden_names
     WHERE establishment_id = $1
     ORDER BY created_at ASC, id ASC`,
    [establishmentId],
  );
  return [...hiddenRows.rows, ...remembered.rows];
};

/**
 * Atomically replace all menu items for a media file.
 *
 * Single transaction: SELECT previous items (locked) → DELETE existing items for
 * this media → INSERT new items, carrying the moderator's decisions over.
 *
 * Search results will never observe a partial state because the whole replacement
 * is one transaction and the GIN trigram index is consistent on commit.
 *
 * The moderator's «Скрыть» survives the re-read («повторить распознавание»,
 * scripts/reocr-menus) and follows the dish into the establishment's other
 * files — a new photo or PDF of the same menu, a file deleted and uploaded
 * again: a new row of a dish hidden in this file, in another file or in the
 * establishment's memory inherits is_hidden_by_admin and hidden_reason
 * (collectModerationDecisions; readHiddenElsewhere). Inside this file a
 * section decides first, as before: «Чай» under «Завтраки» the moderator left
 * shown next to the hidden «Чай» under «Напитки» stays shown.
 *
 * The previous rows are read FOR UPDATE, so a «Скрыть» clicked while the
 * re-read is being written either lands before it — and is carried — or waits
 * for it and finds its row gone, instead of being lost silently; the
 * establishment's lock (lockEstablishmentMenu) does the same for a «Скрыть»
 * on another file.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.mediaId - UUID
 * @param {Object[]} params.newItems - New items to insert
 * @returns {Promise<{previousItems: Object[], newItems: Object[], carriedHidden: number,
 *                    hiddenFromElsewhere: Object[]}>}
 *          previousItems for sanity check delta comparison; newItems with generated IDs;
 *          carriedHidden — new rows that inherited a «Скрыть»; hiddenFromElsewhere —
 *          those of them hidden for a decision this file did not hold (another file,
 *          the establishment's memory): the dish arrived with a new file
 */
export const replaceForMedia = async ({ establishmentId, mediaId, newItems }) => {
  const withMemory = await hiddenNamesTableExists();
  if (!withMemory) {
    logger.warn('menu_item_hidden_names is absent (migration 038) — hidden dishes followed only through the rows of other files', {
      establishmentId,
      mediaId,
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await lockEstablishmentMenu(client, establishmentId);

    const prevResult = await client.query(
      'SELECT * FROM menu_items WHERE media_id = $1 ORDER BY position ASC FOR UPDATE',
      [mediaId],
    );
    const previousItems = prevResult.rows;
    const hiddenElsewhere = await readHiddenElsewhere(client, establishmentId, mediaId, withMemory);

    await client.query('DELETE FROM menu_items WHERE media_id = $1', [mediaId]);

    let insertedItems = [];
    let carriedHidden = 0;
    let hiddenFromElsewhere = [];
    if (newItems && newItems.length > 0) {
      const ownDecisions = collectModerationDecisions(previousItems);
      const decisions = collectModerationDecisions([...previousItems, ...hiddenElsewhere]);
      const itemsWithDecisions = newItems.map((item) => {
        const decision = ownSectionDecision(item, ownDecisions) ?? inheritedDecision(item, decisions);
        if (decision.hidden) carriedHidden += 1;
        return { ...item, is_hidden_by_admin: decision.hidden, hidden_reason: decision.reason };
      });

      const { valuesClause, params } = buildBulkInsertFragment(
        itemsWithDecisions,
        establishmentId,
        mediaId,
        { withModeration: true },
      );

      const insertQuery = `
        INSERT INTO menu_items (
          establishment_id, media_id, item_name, price_byn,
          category_raw, confidence, sanity_flag, position,
          is_hidden_by_admin, hidden_reason
        )
        VALUES ${valuesClause}
        RETURNING *
      `;

      const insertResult = await client.query(insertQuery, params);
      insertedItems = insertResult.rows;

      // Told by the rows themselves, not by the order RETURNING gives them in.
      hiddenFromElsewhere = insertedItems.filter(
        row => row.is_hidden_by_admin === true && !inheritedDecision(row, ownDecisions).hidden,
      );
    }

    await client.query('COMMIT');

    logger.info('Menu items replaced for media', {
      mediaId,
      establishmentId,
      previousCount: previousItems.length,
      newCount: insertedItems.length,
      carriedHidden,
      hiddenFromElsewhere: hiddenFromElsewhere.length,
      withMemory,
    });

    return {
      previousItems,
      newItems: insertedItems,
      carriedHidden,
      hiddenFromElsewhere,
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
 * Remember dishes hidden in the establishment (migration 038): one entry per
 * name and section as stored, with the reason; an entry already there is not
 * doubled. The rule of what counts as the same dish is applied when reading
 * (dishKey), not here.
 *
 * @param {Object} client - Connected client inside BEGIN
 * @param {string} establishmentId - UUID
 * @param {Object[]} rows - menu_items rows being hidden
 * @param {string} reason - The moderator's reason
 */
const rememberHidden = async (client, establishmentId, rows, reason) => {
  const seen = new Set();
  for (const row of rows) {
    const key = JSON.stringify([row.item_name, row.category_raw ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    await client.query(
      `INSERT INTO menu_item_hidden_names (establishment_id, item_name, category_raw, hidden_reason)
       SELECT $1::uuid, $2::varchar, $3::varchar, $4::text
       WHERE NOT EXISTS (
         SELECT 1 FROM menu_item_hidden_names
         WHERE establishment_id = $1::uuid
           AND item_name = $2::varchar
           AND category_raw IS NOT DISTINCT FROM $3::varchar
           AND hidden_reason IS NOT DISTINCT FROM $4::text
       )`,
      [establishmentId, row.item_name, row.category_raw ?? null, reason],
    );
  }
};

/**
 * Open the transaction of a moderator's action on one row: lock the
 * establishment's menu (lockEstablishmentMenu) and read every row of it.
 *
 * @returns {Promise<{establishmentId: string, row: (Object|null), rows: Object[]}|null>}
 *          null — no such row
 */
const openEstablishmentMenu = async (client, menuItemId) => {
  const owner = await client.query(
    'SELECT id, establishment_id FROM menu_items WHERE id = $1',
    [menuItemId],
  );
  if (owner.rowCount === 0) return null;
  const { id, establishment_id: establishmentId } = owner.rows[0];

  await lockEstablishmentMenu(client, establishmentId);

  // Same order as getByEstablishmentId: the guest's lines are grouped from it.
  const { rows } = await client.query(
    `SELECT * FROM menu_items
     WHERE establishment_id = $1
     ORDER BY position ASC, item_name ASC`,
    [establishmentId],
  );
  // A re-read of the row's file may have replaced it while the lock was awaited.
  return { establishmentId, row: rows.find(r => r.id === id) ?? null, rows };
};

/**
 * Run fn inside a transaction on a client of its own.
 */
const inTransaction = async (fn) => {
  const client = await pool.connect();
  let broken = null;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query(result?.status === 'done' ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    // A failed ROLLBACK must not stand in for the error that caused it, and a
    // client in that state is not given back to the pool as healthy.
    await client.query('ROLLBACK').catch((rollbackError) => { broken = rollbackError; });
    throw error;
  } finally {
    client.release(broken ?? undefined);
  }
};

/**
 * The moderator's «Скрыть» on one row, for the dish (decision of the
 * Coordinator 29.10.2026, п. 3а, П2а): hidden are the row, the other rows of
 * the line the guest sees (findCopies — repeats of the line in its own file
 * too), and every shown row of the same dish (dishKey) in the establishment's
 * OTHER files, in any section and at any price. Inside the row's own file a
 * section decides first, as on a re-read: «Чай» under «Завтраки» next to the
 * hidden «Чай» under «Напитки» stays shown.
 *
 * The dish is remembered (migration 038, when applied), so that a file
 * uploaded later — or this one deleted and uploaded again — comes back with
 * it hidden (replaceForMedia). One transaction under the establishment's lock.
 *
 * @param {Object} params
 * @param {string} params.menuItemId - UUID
 * @param {string} params.reason - The moderator's reason
 * @returns {Promise<{status: 'gone'}|{status: 'already'}|
 *                   {status: 'done', row: Object, others: Object[]}>}
 *          others — the other rows hidden, as they were before
 */
export const hideDish = async ({ menuItemId, reason }) => {
  const withMemory = await hiddenNamesTableExists();

  return inTransaction(async (client) => {
    const menu = await openEstablishmentMenu(client, menuItemId);
    if (!menu || !menu.row) return { status: 'gone' };
    const { establishmentId, row, rows } = menu;
    if (row.is_hidden_by_admin === true) return { status: 'already' };

    const key = dishKey(row.item_name);
    const section = dishKey(row.category_raw);
    const shown = rows.filter(r => r.id === row.id || r.is_hidden_by_admin !== true);
    const others = new Map();
    for (const copy of findCopies(row.id, shown)) others.set(copy.id, copy);
    for (const r of shown) {
      if (r.id === row.id || dishKey(r.item_name) !== key) continue;
      // Other files — any section; its own file — the same section only, as a
      // re-read of the file would decide (ownSectionDecision): «Чай 3 BYN»
      // next to the hidden «Чай 4 BYN» under the same «Напитки» goes too.
      if (r.media_id !== row.media_id || dishKey(r.category_raw) === section) others.set(r.id, r);
    }

    const ids = [row.id, ...others.keys()];
    const updated = await client.query(
      `UPDATE menu_items
       SET is_hidden_by_admin = TRUE, hidden_reason = $2, updated_at = NOW()
       WHERE id = ANY($1::uuid[])
       RETURNING *`,
      [ids, reason],
    );
    // Deleting a menu file cascades its rows without the lock: one may have
    // gone between the read and the update. The row acted on gone — nothing
    // is kept (409); another row gone — it is not reported as changed.
    const updatedRow = updated.rows.find(r => r.id === row.id);
    if (!updatedRow) return { status: 'gone' };
    const updatedIds = new Set(updated.rows.map(r => r.id));
    const changed = [...others.values()].filter(r => updatedIds.has(r.id));
    if (withMemory) await rememberHidden(client, establishmentId, [row, ...changed], reason);

    return { status: 'done', row: updatedRow, others: changed };
  });
};

/**
 * The moderator's «Показать снова» on one row, for the dish (decision of the
 * Coordinator 29.10.2026, П3а): shown again are all rows of the establishment
 * with the same dish (dishKey) hidden for the same reason, in every file, and
 * the dish is forgotten (migration 038) — or the next file, or the next
 * re-read of a file still holding one of them hidden, would hide it again.
 * A row hidden for another reason was a decision of its own and stays hidden.
 * One transaction under the establishment's lock.
 *
 * @param {Object} params
 * @param {string} params.menuItemId - UUID
 * @returns {Promise<{status: 'gone'}|{status: 'not_hidden'}|
 *                   {status: 'done', row: Object, others: Object[], forgotten: number}>}
 */
export const unhideDish = async ({ menuItemId }) => {
  const withMemory = await hiddenNamesTableExists();

  return inTransaction(async (client) => {
    const menu = await openEstablishmentMenu(client, menuItemId);
    if (!menu || !menu.row) return { status: 'gone' };
    const { establishmentId, row, rows } = menu;
    if (row.is_hidden_by_admin !== true) return { status: 'not_hidden' };

    const key = dishKey(row.item_name);
    const reason = row.hidden_reason ?? null;
    const sameDecision = r => dishKey(r.item_name) === key && (r.hidden_reason ?? null) === reason;
    const others = rows.filter(r => r.id !== row.id && r.is_hidden_by_admin === true && sameDecision(r));

    const updated = await client.query(
      `UPDATE menu_items
       SET is_hidden_by_admin = FALSE, hidden_reason = NULL, updated_at = NOW()
       WHERE id = ANY($1::uuid[])
       RETURNING *`,
      [[row.id, ...others.map(r => r.id)]],
    );
    // A row gone with its file meanwhile (see hideDish).
    const updatedRow = updated.rows.find(r => r.id === row.id);
    if (!updatedRow) return { status: 'gone' };
    const updatedIds = new Set(updated.rows.map(r => r.id));

    let forgotten = 0;
    if (withMemory) {
      const remembered = await client.query(
        'SELECT id, item_name, hidden_reason FROM menu_item_hidden_names WHERE establishment_id = $1',
        [establishmentId],
      );
      const ids = remembered.rows.filter(sameDecision).map(r => r.id);
      if (ids.length > 0) {
        const deleted = await client.query(
          'DELETE FROM menu_item_hidden_names WHERE id = ANY($1::uuid[])',
          [ids],
        );
        forgotten = deleted.rowCount;
      }
    }

    return {
      status: 'done',
      row: updatedRow,
      others: others.filter(r => updatedIds.has(r.id)),
      forgotten,
    };
  });
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
      value: likeContains(search),
    });
  }

  return filters;
};

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
  // The queue is the panel's only list of menu items, so every row hidden by a
  // moderator is in it — with a flag or without one (finding К-1, 29.10.2026).
  // A hidden row loses its flag often: a copy hidden with its line, a row a
  // re-read carried the hiding over to, a row whose flag was dismissed, a row
  // hidden in a new file because the dish was hidden before. Without this it
  // left the panel for good, and «Показать снова» could not be reached. A shown
  // row is in the queue only with a flag, as before: «Активные» and the rail
  // badge do not change.
  const parts = ['(mi.sanity_flag IS NOT NULL OR mi.is_hidden_by_admin = TRUE)'];

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
 * List items with a non-null sanity_flag, and every item hidden by a moderator
 * (composeWhere), JOINed with parent establishment
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
      e.cuisines     AS establishment_cuisines,
      -- The menu file the row was read from: the moderator checks a flag
      -- against the photo or PDF itself (walkthrough of the moderator panel,
      -- 2026-10-20, A1-08). LEFT JOIN — a row is never dropped for its file.
      m.url          AS media_url,
      m.file_type    AS media_file_type,
      m.preview_url  AS media_preview_url,
      m.thumbnail_url AS media_thumbnail_url
    FROM menu_items mi
    JOIN establishments e ON e.id = mi.establishment_id
    LEFT JOIN establishment_media m ON m.id = mi.media_id
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
