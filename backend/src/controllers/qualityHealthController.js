/**
 * Quality Health Controller — AI-ops Brick-1.
 *
 * Thin HTTP layer: delegates to qualityHealthService, formats the standard
 * { success, data } envelope. Read-only; admin-guarded at the route.
 *
 * Endpoint: GET /api/v1/admin/quality/health
 */

import * as qualityHealthService from '../services/qualityHealthService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * GET /api/v1/admin/quality/health[?refresh=1]
 *
 * Tier-0 quality-immunity snapshot over active establishments: canon/slug
 * reachability, menu completeness, geo bounds, working-hours sanity, attribute
 * census, hanging OCR flags. (Price distribution stubbed until the real-500 import.)
 *
 * `refresh` bypasses the service cache. It exists because the screen has an "Обновить"
 * button: without it, pressing refresh inside the TTL would return the same snapshot and
 * the button would read as broken. Unlike the badges endpoint — whose cache is dropped by
 * the write paths and therefore needs no client-side escape hatch — this cache is only
 * ever cleared by time or by this flag.
 */
export const getHealth = asyncHandler(async (req, res) => {
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const data = await qualityHealthService.getQualityHealth({ force });

  logger.info('Admin fetched quality health', {
    adminId: req.user.userId,
    endpoint: 'GET /api/v1/admin/quality/health',
    forced: force,
  });

  res.status(200).json({ success: true, data });
});
