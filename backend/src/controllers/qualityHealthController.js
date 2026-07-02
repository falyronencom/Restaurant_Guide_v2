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
 * GET /api/v1/admin/quality/health
 *
 * Tier-0 quality-immunity snapshot over active establishments: canon/slug
 * reachability, menu completeness, geo bounds, working-hours sanity, attribute
 * census, hanging OCR flags. (Price distribution stubbed until the real-500 import.)
 */
export const getHealth = asyncHandler(async (req, res) => {
  const data = await qualityHealthService.getQualityHealth();

  logger.info('Admin fetched quality health', {
    adminId: req.user.userId,
    endpoint: 'GET /api/v1/admin/quality/health',
  });

  res.status(200).json({ success: true, data });
});
