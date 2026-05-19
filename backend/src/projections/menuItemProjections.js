/**
 * Menu Item Public Projection
 *
 * Pure function that transforms raw menu_items DB row into public-safe shape.
 * Excludes admin/moderation metadata and the OCR confidence signal.
 *
 * Excluded fields:
 *   - media_id (internal FK to source PDF)
 *   - sanity_flag (admin-only OCR quality metadata)
 *   - is_hidden_by_admin (filter flag, items already filtered upstream)
 *   - hidden_reason (admin moderator note)
 *   - confidence (OCR confidence — Brief 4 will decide on public exposure
 *     for differentiated display per Политика 3)
 *
 * Callers must ensure is_hidden_by_admin=FALSE filtering at query layer
 * (per MenuItemModel.getByEstablishmentId({ includeHidden: false })).
 */

/**
 * Convert raw menu_item row to public projection.
 *
 * @param {Object} item - menu_items row
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
  };
};
