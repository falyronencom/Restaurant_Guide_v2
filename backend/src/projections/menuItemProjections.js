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
 * The section a line stands in, as the guest reads it: letters and digits
 * only — two reads of one board give «—Д•О•П•О•Л•Н•И•Т•Е•Л•Ь•Н•О—» and
 * «-ДОПОЛНИТЕЛЬНО-» (Shelbi, 2026-10-19). '' — no section read (or one of
 * symbols only, «***»): it matches no section.
 *
 * @param {Object} item - menu_items row
 * @returns {string}
 */
const sectionKey = (item) => readAsGuest(item.category_raw).replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Which files are copies of one menu. A file is a copy of a menu when it
 * shares at least half the lines of the smaller of it and the menu's biggest
 * file (VARKA: the photo of the board and the PDF); a breakfast menu and a
 * lunch menu sharing «Морс» are two menus.
 *
 * Files are taken biggest first (ties by id); each joins the first menu whose
 * biggest file it copies, or starts its own. A file is never matched against
 * another copy, only against the menu's biggest file: a small board sharing
 * «Морс» with both the breakfast and the lunch menu would otherwise chain them
 * into one (Phase 3.5 review, 2026-10-19).
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

  const files = [...linesPerFile.keys()].sort((a, b) => {
    const bySize = linesPerFile.get(b).size - linesPerFile.get(a).size;
    if (bySize !== 0) return bySize;
    if (String(a) === String(b)) return 0;
    return String(a) < String(b) ? -1 : 1;
  });

  const biggestFiles = [];
  const menuOf = new Map();
  for (const file of files) {
    const lines = linesPerFile.get(file);
    const menu = biggestFiles.find((biggest) => {
      const menuLines = linesPerFile.get(biggest);
      let shared = 0;
      for (const key of lines) if (menuLines.has(key)) shared += 1;
      return shared * 2 >= Math.min(lines.size, menuLines.size);
    });
    if (menu === undefined) {
      biggestFiles.push(file);
      menuOf.set(file, file);
    } else {
      menuOf.set(file, menu);
    }
  }

  return (mediaId) => JSON.stringify(menuOf.get(mediaId) ?? null);
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
 * 2026-10-19 on its two findings; option «А» after PR #107 brought back
 * repeats on five cards):
 *   - inside one file, the same line (guestLineKey) in the same section is one
 *     line — recognition read it twice; in another section it is the menu's own
 *     (a syrup sold with coffee and with tea) and stays;
 *   - across files, the same line in the same section (sectionKey) is one line,
 *     however little else the files share: the oyster card and the main menu
 *     both list the oysters under «УСТРИЧНЫЙ БАР» (SFB);
 *   - across files that are copies of one menu (menuOfFile) the same line is
 *     one line even under a section spelled otherwise («ПИЦЦА ИЗ ПЕЧИ» /
 *     «Пицца на огне») or not read at all;
 *   - otherwise the files are different menus and the line stays in each:
 *     «дополнительное блюдо» in «ОБЕД из 4 блюд» and in «ЗАВТРАК из 4 блюд».
 *     A line without a section tells nothing about its menu: across different
 *     menus it joins nothing;
 *   - every two rows of a line agree — same menu or same section. A line is
 *     checked against all rows already in the group, not against one of them:
 *     a board without headings that copies the lunch menu joins the lunch
 *     «Морс» and does not carry the breakfast «Морс» in with it (Phase 3.5
 *     review of option «А», 2026-10-19). The price of it: where two menus
 *     share a section and one of them has a board without headings, the
 *     board's line may stay a line of its own — a repeat, never a dish lost
 *     or two menus merged;
 *   - a different price is not a repeat — both are shown. A menu that lists
 *     the syrup twice still gives two lines: the lines of the first file (by
 *     id) are the slots, and the lines of the other files take them — a slot
 *     in the same section first, then any other that agrees (one of the same
 *     menu), then new ones;
 *   - lines are ordered by their first row.
 *
 * @param {Object[]} rows - menu_items rows of one establishment, in menu order
 * @returns {Object[][]} One array of rows per guest line
 */
export const groupGuestLines = (rows) => {
  const menuOf = menuOfFile(rows);

  // One file, one line, one section: one file line.
  const fileLineById = new Map();
  const fileLinesByKey = new Map();
  rows.forEach((row, index) => {
    const key = guestLineKey(row);
    const section = sectionKey(row);
    const id = JSON.stringify([row.media_id ?? null, key, section]);
    let line = fileLineById.get(id);
    if (!line) {
      line = { file: String(row.media_id ?? null), menu: menuOf(row.media_id), section, first: index, rows: [] };
      fileLineById.set(id, line);
      if (!fileLinesByKey.has(key)) fileLinesByKey.set(key, []);
      fileLinesByKey.get(key).push(line);
    }
    line.rows.push(row);
  });

  const sameSection = (a, b) => a.section !== '' && a.section === b.section;
  const agree = (a, b) => a.menu === b.menu || sameSection(a, b);

  const groups = [];
  for (const fileLines of fileLinesByKey.values()) {
    const linesPerFile = new Map();
    for (const line of fileLines) {
      if (!linesPerFile.has(line.file)) linesPerFile.set(line.file, []);
      linesPerFile.get(line.file).push(line);
    }
    // Files by id — not by row order, which is not fixed between rows of
    // equal position and name.
    const files = [...linesPerFile.keys()].sort((a, b) => {
      if (a === b) return 0;
      return a < b ? -1 : 1;
    });

    const slots = linesPerFile.get(files[0]).map(line => [line]);
    const open = (slot, line) => slot.every(other => other.file !== line.file && agree(other, line));
    for (const file of files.slice(1)) {
      const waiting = [];
      for (const line of linesPerFile.get(file)) {
        const slot = slots.find(s => open(s, line) && s.some(other => sameSection(other, line)));
        if (slot) slot.push(line);
        else waiting.push(line);
      }
      // A slot open to a line that shares no section with it is one of its
      // own menu: every row of it agrees with the line.
      for (const line of waiting) {
        const slot = slots.find(s => open(s, line));
        if (slot) slot.push(line);
        else slots.push([line]);
      }
    }

    for (const slot of slots) {
      groups.push({
        first: Math.min(...slot.map(line => line.first)),
        rows: slot.flatMap(line => line.rows),
      });
    }
  }

  return groups.sort((a, b) => a.first - b.first).map(group => group.rows);
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
