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
 * Text as two recognitions of one menu may differ in it: the name as
 * normalizeMenuItemName reads it (case, spaces), plus ё/е, the kind of dash and
 * quotes. Quotes go before the spaces are collapsed: «Салат « Цезарь »» and
 * «Салат "Цезарь"» must meet on one spacing.
 *
 * @param {string|null|undefined} text
 * @returns {string}
 */
const readAsGuest = (text) => normalizeMenuItemName(
  (text ?? '')
    .replace(/["«»„“”'‘’‚‛]/g, '')
    .replace(/[‐-―−]/g, '-'),
).replace(/ё/g, 'е');

/**
 * What the guest takes for "the same line" of a menu: the same name
 * (readAsGuest) and the price to the kopeck (no price is a price of its own).
 *
 * @param {Object} item - menu_items row
 * @returns {string}
 */
const guestLineKey = (item) => {
  const price = item.price_byn !== null && item.price_byn !== undefined
    ? parseFloat(item.price_byn).toFixed(2)
    : '';
  return JSON.stringify([readAsGuest(item.item_name), price]);
};

/**
 * Which files are copies of one menu. Two files are copies when they share at
 * least half the lines of the smaller one (VARKA: the photo of the board and
 * the PDF); a breakfast menu and a lunch menu sharing «Морс» are two menus.
 * Copies of copies are one menu.
 *
 * @param {Object[]} rows - menu_items rows of one establishment
 * @returns {(mediaId: string) => string} The menu a file belongs to
 */
const menuOfFile = (rows) => {
  const linesPerFile = new Map();
  for (const row of rows) {
    if (!linesPerFile.has(row.media_id)) linesPerFile.set(row.media_id, new Set());
    linesPerFile.get(row.media_id).add(guestLineKey(row));
  }

  const files = [...linesPerFile.keys()];
  const parent = new Map(files.map(file => [file, file]));
  const find = (file) => {
    let root = file;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };

  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = linesPerFile.get(files[i]);
      const b = linesPerFile.get(files[j]);
      let shared = 0;
      for (const key of a) if (b.has(key)) shared += 1;
      if (shared * 2 >= Math.min(a.size, b.size)) parent.set(find(files[j]), find(files[i]));
    }
  }

  return (mediaId) => JSON.stringify(find(mediaId) ?? null);
};

/**
 * The lines the guest sees, each with every row it stands for.
 *
 * A partner may upload the same menu twice — a photo of the board and the PDF —
 * and each file is recognised on its own, so every dish arrives once per file
 * (VARKA (Новая Боровая), 2026-10-19: 127 rows, 56 of them repeats). The rows
 * stay in the database file by file; the guest's view collapses them, and a
 * partner's edit or a moderator's «Скрыть» on one row reaches the others of its
 * line (findCopies).
 *
 * Rules (brief LEAF_BRIEF_MENU_DUPLICATES and the Coordinator's word of
 * 2026-10-19 on its two findings):
 *   - inside one file, the same line (guestLineKey) in the same section is one
 *     line — recognition read it twice; in another section it is the menu's own
 *     (a syrup sold with coffee and with tea) and stays;
 *   - across files that are copies of one menu (menuOfFile) the same line is
 *     one line; a different price is not a repeat — both are shown; the n-th
 *     line of a file pairs with the n-th of another, so two files of a menu
 *     that lists the syrup twice still give two lines;
 *   - files that are different menus are not collapsed: a dish both list
 *     stays in each menu's section;
 *   - lines are ordered by their first row.
 *
 * @param {Object[]} rows - menu_items rows of one establishment, in menu order
 * @returns {Object[][]} One array of rows per guest line
 */
export const groupGuestLines = (rows) => {
  const menuOf = menuOfFile(rows);
  const groups = [];
  const groupOfFileLine = new Map();
  const linesByMenuKey = new Map();

  for (const row of rows) {
    const key = guestLineKey(row);
    const fileLine = JSON.stringify([row.media_id ?? null, key, readAsGuest(row.category_raw)]);
    const known = groupOfFileLine.get(fileLine);
    if (known !== undefined) {
      groups[known].push(row);
      continue;
    }

    const menuKey = JSON.stringify([menuOf(row.media_id), key]);
    let entry = linesByMenuKey.get(menuKey);
    if (!entry) {
      entry = { slots: [], seenPerFile: new Map() };
      linesByMenuKey.set(menuKey, entry);
    }
    const lineInFile = entry.seenPerFile.get(row.media_id) ?? 0;
    entry.seenPerFile.set(row.media_id, lineInFile + 1);

    let group = entry.slots[lineInFile];
    if (group === undefined) {
      group = groups.length;
      groups.push([]);
      entry.slots.push(group);
    }
    groups[group].push(row);
    groupOfFileLine.set(fileLine, group);
  }

  return groups;
};

/**
 * Show one menu once, however many files it was uploaded as (groupGuestLines).
 *
 * Which row of a line the guest sees:
 *   - a clean one before one in question (CAT-C-2.7: in question is shown
 *     with a mark, clean without);
 *   - otherwise one from the same file for the whole menu — the file with the
 *     most lines, ties by its id. The site groups lines by the section name as
 *     read (category_raw); two reads may spell a section differently
 *     («КОФЕ» / «Кофе»), and rows picked file by file would split it in two.
 *     Rows of equal position and name from two files arrive in no fixed order,
 *     so «the first row» would not be a stable choice either.
 *
 * Hidden rows must already be filtered out: a row the moderator hid is not a
 * candidate.
 *
 * @param {Object[]} rows - menu_items rows of one establishment, in menu order
 * @returns {Object[]} The rows the guest sees
 */
export const collapseMenuRepeats = (rows) => {
  const linesPerFile = new Map();
  for (const row of rows) {
    linesPerFile.set(row.media_id, (linesPerFile.get(row.media_id) ?? 0) + 1);
  }
  const fileComesFirst = (a, b) => {
    const byLines = linesPerFile.get(a.media_id) - linesPerFile.get(b.media_id);
    if (byLines !== 0) return byLines > 0;
    return String(a.media_id) < String(b.media_id);
  };
  const isPreferred = (candidate, shown) => {
    const candidateClean = candidate.sanity_flag == null;
    const shownClean = shown.sanity_flag == null;
    if (candidateClean !== shownClean) return candidateClean;
    return fileComesFirst(candidate, shown);
  };

  return groupGuestLines(rows).map(group => group.reduce(
    (shown, row) => (isPreferred(row, shown) ? row : shown),
  ));
};

/**
 * The other rows of the guest line a row belongs to — its copies in the other
 * files of the same menu and its repeats in the same section of its file.
 *
 * @param {string} rowId - menu_items.id
 * @param {Object[]} rows - menu_items rows of the row's establishment
 * @returns {Object[]} The copies, without the row itself
 */
export const findCopies = (rowId, rows) => {
  const group = groupGuestLines(rows).find(lines => lines.some(row => row.id === rowId));
  return group ? group.filter(row => row.id !== rowId) : [];
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
