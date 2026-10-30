/**
 * What "the same dish" means between two reads of one menu file.
 *
 * Two rules compare an item of a new OCR read with the items of the previous
 * read, and they must agree on what counts as the same name:
 *   - sanityChecker's price_delta_anomaly (a price that jumped more than 3×),
 *   - menuItemModel.replaceForMedia carrying the moderator's «Скрыть» over to
 *     the new row.
 * Lowercase, trimmed, inner whitespace collapsed to one space.
 *
 * @param {string} name - item_name as read or stored
 * @returns {string}
 */
export const normalizeMenuItemName = (name) => name.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Text as two recognitions of one menu may differ in it — two reads of one
 * file, or a photo and a PDF of the same menu: the name as
 * normalizeMenuItemName reads it (case, spaces), plus ё/е, the kind of dash
 * and quotes. Quotes go before the spaces are collapsed: «Салат « Цезарь »»
 * and «Салат "Цезарь"» must meet on one spacing.
 *
 * The guest's view of a menu groups its lines by it (menuItemProjections),
 * and a moderator's «Скрыть» follows the dish by it into the other files of
 * the establishment, the ones uploaded later included (menuItemModel —
 * decision of the Coordinator 29.10.2026, п. 3а, П1а).
 *
 * @param {string|null|undefined} text - item_name or category_raw
 * @returns {string}
 */
export const dishKey = (text) => normalizeMenuItemName(
  (text ?? '')
    .replace(/["«»„“”'‘’‚‛]/g, '')
    .replace(/[‐-―−]/g, '-'),
).replace(/ё/g, 'е');
