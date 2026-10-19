/**
 * Menu Item Public Projection
 *
 * Pure function that transforms raw menu_items DB row into public-safe shape.
 * Excludes admin/moderation metadata; emits a derived two-tier quality signal
 * (quality_tier) so consumers can render a caution indicator without exposing
 * the underlying sanity_flag content.
 *
 * Excluded fields (NEVER appear in public projection output):
 *   - media_id (internal FK to source PDF)
 *   - sanity_flag (admin-only OCR quality metadata; surfaced only as derived
 *     quality_tier — see below)
 *   - is_hidden_by_admin (filter flag, items already filtered upstream)
 *   - hidden_reason (admin moderator note)
 *   - confidence (OCR confidence — folded into sanity_flag detection via
 *     MIN_CONFIDENCE threshold in sanityChecker; per Brief 4 / CAT-C-2.7
 *     augmentation we don't surface raw confidence as a public field)
 *
 * Derived public field:
 *   - quality_tier: 'clean' | 'needs_caution'
 *     'clean' when sanity_flag IS NULL (item passed all OCR-quality rules);
 *     'needs_caution' when sanity_flag IS NOT NULL (item failed at least one
 *     rule — low_confidence / price_below_threshold / price_above_threshold /
 *     price_delta_anomaly per sanityChecker.js). Consumers render a caution
 *     indicator on 'needs_caution' items; structured-data emitters (JSON-LD)
 *     should include only 'clean' items.
 *
 * Callers must ensure is_hidden_by_admin=FALSE filtering at query layer
 * (per MenuItemModel.getByEstablishmentId({ includeHidden: false })).
 */

import { normalizeMenuItemName } from '../utils/menuItemName.js';

/**
 * What the guest takes for "the same line" of a menu: the name as
 * normalizeMenuItemName reads it, plus the noise two recognitions of one menu
 * leave between them — ё/е, the kind of dash, quotes — and the price to the
 * kopeck (no price is a price of its own).
 *
 * @param {Object} item - menu_items row
 * @returns {string}
 */
const guestLineKey = (item) => {
  const name = normalizeMenuItemName(item.item_name ?? '')
    .replace(/ё/g, 'е')
    .replace(/[‐-―−]/g, '-')
    .replace(/["«»„“”']/g, '');
  const price = item.price_byn !== null && item.price_byn !== undefined
    ? parseFloat(item.price_byn).toFixed(2)
    : '';
  return JSON.stringify([name, price]);
};

/**
 * Show one menu once, however many files it was uploaded as.
 *
 * A partner may upload the same menu twice — a photo of the board and the PDF —
 * and each file is recognised on its own, so every dish arrives once per file
 * (VARKA (Новая Боровая), 2026-10-19: 127 rows, 56 of them repeats). The rows
 * stay in the database file by file — the partner's cabinet and the moderator's
 * panel edit them per file; only the guest's view collapses them.
 *
 * Rules (brief LEAF_BRIEF_MENU_DUPLICATES, 2026-10-19):
 *   - the same name and the same price (guestLineKey) from different files is
 *     one line; a different price is not a repeat — both are shown;
 *   - a line the menu itself repeats inside one file (a syrup sold with coffee
 *     and with tea) stays repeated: the n-th copy in one file pairs with the
 *     n-th copy in another, so two files of that menu still give two lines;
 *   - where one copy is clean and another is in question, the guest sees the
 *     clean one (CAT-C-2.7: in question is shown with a mark, clean without);
 *   - the line keeps the place of its first copy, so the menu reads in the
 *     order it came in.
 *
 * Hidden rows must already be filtered out: a copy the moderator hid is not a
 * candidate, and the dish shows once from the file where it is not hidden.
 *
 * @param {Object[]} rows - menu_items rows of one establishment, in menu order
 * @returns {Object[]} The rows the guest sees
 */
export const collapseRepeatsAcrossFiles = (rows) => {
  const lines = [];
  const linesByKey = new Map();

  for (const row of rows) {
    const key = guestLineKey(row);
    let entry = linesByKey.get(key);
    if (!entry) {
      entry = { slots: [], seenPerFile: new Map() };
      linesByKey.set(key, entry);
    }

    const copyInFile = entry.seenPerFile.get(row.media_id) ?? 0;
    entry.seenPerFile.set(row.media_id, copyInFile + 1);

    const slot = entry.slots[copyInFile];
    if (slot === undefined) {
      entry.slots.push(lines.length);
      lines.push(row);
    } else if (lines[slot].sanity_flag != null && row.sanity_flag == null) {
      lines[slot] = row;
    }
  }

  return lines;
};

/**
 * Convert raw menu_item row to public projection.
 *
 * @param {Object} item - menu_items row (must include sanity_flag column;
 *                       MenuItemModel.getByEstablishmentId selects *)
 * @returns {Object} Public projection
 */
export const toPublicMenuItem = (item) => {
  if (!item) return null;

  return {
    id: item.id,
    establishment_id: item.establishment_id,
    item_name: item.item_name,
    price_byn: item.price_byn !== null && item.price_byn !== undefined
      ? parseFloat(item.price_byn)
      : null,
    category_raw: item.category_raw,
    position: typeof item.position === 'number' ? item.position : 0,
    quality_tier: item.sanity_flag != null ? 'needs_caution' : 'clean',
  };
};
