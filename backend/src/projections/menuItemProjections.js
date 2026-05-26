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
