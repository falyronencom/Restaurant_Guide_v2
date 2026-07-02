/**
 * Quality Health Service — AI-ops Brick-1 orchestration.
 *
 * Composes the read-only quality-immunity signals from qualityHealthModel into a
 * single health payload for the admin supervisor panel. No business logic beyond
 * assembly — the invariants live in the model.
 */

import * as qualityHealthModel from '../models/qualityHealthModel.js';

/**
 * Assemble the full Tier-0 quality-health snapshot (scope: active establishments).
 * @returns {Promise<Object>}
 */
export const getQualityHealth = async () => {
  const [
    unreachable,
    offCanon,
    menuCompleteness,
    geo,
    hours,
    attributeCensus,
    flags,
    priceDistribution,
  ] = await Promise.all([
    qualityHealthModel.getUnreachableEstablishments(),
    qualityHealthModel.getOffCanonCounts(),
    qualityHealthModel.getMenuCompleteness(),
    qualityHealthModel.getOutOfBoundsEstablishments(),
    qualityHealthModel.getInvalidHours(),
    qualityHealthModel.getAttributeKeyCensus(),
    qualityHealthModel.getHangingFlags(),
    qualityHealthModel.getPriceDistributionAnomalies(),
  ]);

  return {
    scope: 'active',
    generated_at: new Date().toISOString(),
    canon_reachability: {
      unreachable_count: unreachable.count,
      unreachable_samples: unreachable.samples,
      category_offcanon_count: offCanon.category_offcanon_count,
      cuisine_offcanon_count: offCanon.cuisine_offcanon_count,
    },
    menu_completeness: menuCompleteness,
    geo_bounds: geo,
    working_hours: hours,
    attribute_census: attributeCensus,
    hanging_flags: flags,
    price_distribution: priceDistribution,
  };
};
