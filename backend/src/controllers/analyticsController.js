/**
 * Analytics Controller
 *
 * HTTP handlers for admin analytics endpoints (Segment D).
 * Thin layer: extracts query params, delegates to analyticsService, formats response.
 *
 * Endpoints:
 *   GET /api/v1/admin/analytics/overview         — dashboard metric cards
 *   GET /api/v1/admin/analytics/users             — user registration & role analytics
 *   GET /api/v1/admin/analytics/establishments    — establishment pipeline analytics
 *   GET /api/v1/admin/analytics/reviews           — review activity & rating analytics
 */

import * as analyticsService from '../services/analyticsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Extract period params from query string.
 * Supports: ?period=7d|30d|90d  or  ?from=2026-01-01&to=2026-01-31
 */
const extractPeriodParams = (query) => ({
  period: query.period || '30d',
  from: query.from || null,
  to: query.to || null,
});

/**
 * GET /api/v1/admin/analytics/overview
 *
 * Dashboard overview with metric cards:
 * users (total, new, change%), establishments (total, active, pending, suspended),
 * reviews (total, new, avg rating), moderation (pending, actions).
 */
export const getOverview = asyncHandler(async (req, res) => {
  const periodParams = extractPeriodParams(req.query);

  const data = await analyticsService.getOverview(periodParams);

  logger.info('Admin fetched analytics overview', {
    adminId: req.user.userId,
    period: periodParams.period,
    endpoint: 'GET /api/v1/admin/analytics/overview',
  });

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * GET /api/v1/admin/analytics/users
 *
 * User analytics: registration timeline, role distribution.
 */
export const getUsersAnalytics = asyncHandler(async (req, res) => {
  const periodParams = extractPeriodParams(req.query);

  const data = await analyticsService.getUsersAnalytics(periodParams);

  logger.info('Admin fetched users analytics', {
    adminId: req.user.userId,
    period: periodParams.period,
    endpoint: 'GET /api/v1/admin/analytics/users',
  });

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * GET /api/v1/admin/analytics/establishments
 *
 * Establishment analytics: creation timeline, status/city/category distributions.
 */
export const getEstablishmentsAnalytics = asyncHandler(async (req, res) => {
  const periodParams = extractPeriodParams(req.query);

  const data = await analyticsService.getEstablishmentsAnalytics(periodParams);

  logger.info('Admin fetched establishments analytics', {
    adminId: req.user.userId,
    period: periodParams.period,
    endpoint: 'GET /api/v1/admin/analytics/establishments',
  });

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * GET /api/v1/admin/analytics/reviews
 *
 * Review analytics: review timeline (count + avg rating), rating distribution,
 * partner response stats.
 */
export const getReviewsAnalytics = asyncHandler(async (req, res) => {
  const periodParams = extractPeriodParams(req.query);

  const data = await analyticsService.getReviewsAnalytics(periodParams);

  logger.info('Admin fetched reviews analytics', {
    adminId: req.user.userId,
    period: periodParams.period,
    endpoint: 'GET /api/v1/admin/analytics/reviews',
  });

  res.status(200).json({
    success: true,
    data,
  });
});
