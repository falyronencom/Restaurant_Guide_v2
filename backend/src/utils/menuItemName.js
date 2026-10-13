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
