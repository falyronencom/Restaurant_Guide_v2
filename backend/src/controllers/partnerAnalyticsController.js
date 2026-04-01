/**
 * Partner Analytics Controller
 *
 * HTTP handlers for partner-facing analytics endpoints.
 * Thin layer: extracts params, delegates to partnerAnalyticsService, formats response.
 *
 * Endpoints:
 *   POST /api/v1/establishments/:id/track-call    — record phone tap
 *   GET  /api/v1/partner/analytics/overview        — per-establishment metrics
 *   GET  /api/v1/partner/analytics/trends          — time-series for charts
 *   GET  /api/v1/partner/analytics/ratings         — rating distribution
 */

import * as partnerAnalyticsService from '../services/partnerAnalyticsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Extract period params from query string.
 * Reuses the same format as admin analytics: ?period=7d|30d|90d or ?from=&to=
 */
const extractPeriodParams = (query) => ({
  period: query.period || '30d',
  from: query.from || null,
  to: query.to || null,
});

/**
 * POST /api/v1/establishments/:id/track-call
 *
 * Lightweight endpoint for recording phone tap events.
 * No auth required (public action triggered from mobile detail page).
 */
export const trackCall = asyncHandler(async (req, res) => {
  const { id } = req.params;

  await partnerAnalyticsService.trackCall(id);

  res.status(200).json({
    success: true,
    data: { message: 'Call event recorded' },
  });
});

/**
 * POST /api/v1/analytics/promotion-view
 *
 * Record a promotion view event. Public endpoint (no auth required).
 */
export const trackPromotionView = asyncHandler(async (req, res) => {
  const { establishmentId } = req.body;

  if (!establishmentId) {
    return res.status(400).json({
      success: false,
      message: 'establishmentId is required',
      error: { code: 'VALIDATION_ERROR' },
    });
  }

  await partnerAnalyticsService.trackPromotionView(establishmentId);

  res.status(200).json({
    success: true,
    data: { message: 'Promotion view event recorded' },
  });
});

/**
 * GET /api/v1/partner/analytics/overview
 *
 * Returns aggregated metrics per establishment for the authenticated partner.
 */
export const getOverview = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const periodParams = extractPeriodParams(req.query);

  const data = await partnerAnalyticsService.getOverview(partnerId, periodParams);

  logger.info('Partner fetched analytics overview', {
    partnerId,
    period: periodParams.period,
    establishmentCount: data.establishments.length,
  });

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * GET /api/v1/partner/analytics/trends
 *
 * Returns time-series data for a specific establishment.
 * Requires ?establishment_id=UUID query param.
 */
export const getTrends = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishment_id } = req.query;
  const periodParams = extractPeriodParams(req.query);

  if (!establishment_id) {
    return res.status(400).json({
      success: false,
      error: { message: 'establishment_id query parameter is required', code: 'MISSING_PARAM' },
    });
  }

  const data = await partnerAnalyticsService.getTrends(partnerId, establishment_id, periodParams);

  logger.info('Partner fetched analytics trends', {
    partnerId,
    establishmentId: establishment_id,
    period: periodParams.period,
  });

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * GET /api/v1/partner/analytics/ratings
 *
 * Returns rating distribution for a specific establishment.
 * Requires ?establishment_id=UUID query param.
 */
export const getRatings = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishment_id } = req.query;

  if (!establishment_id) {
    return res.status(400).json({
      success: false,
      error: { message: 'establishment_id query parameter is required', code: 'MISSING_PARAM' },
    });
  }

  const data = await partnerAnalyticsService.getRatings(partnerId, establishment_id);

  logger.info('Partner fetched analytics ratings', {
    partnerId,
    establishmentId: establishment_id,
  });

  res.status(200).json({
    success: true,
    data,
  });
});
