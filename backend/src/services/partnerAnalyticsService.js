/**
 * Partner Analytics Service
 *
 * Business logic for partner-facing analytics endpoints.
 * Reuses period utilities from analyticsService.js (parsePeriod,
 * getAggregationType, fillDateGaps, computeChangePercent).
 *
 * Scoped: all queries are restricted to partner-owned establishments.
 */

import * as PartnerAnalyticsModel from '../models/partnerAnalyticsModel.js';
import {
  parsePeriod,
  getAggregationType,
  fillDateGaps,
  computeChangePercent,
} from './analyticsService.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

// ============================================================================
// Event Tracking
// ============================================================================

/**
 * Record a phone call click event.
 * Validates that the establishment exists and is active.
 *
 * @param {string} establishmentId - UUID
 */
export const trackCall = async (establishmentId) => {
  await PartnerAnalyticsModel.trackCall(establishmentId);
  logger.debug('Call event tracked', { establishmentId });
};

// ============================================================================
// Analytics Endpoints
// ============================================================================

/**
 * GET /api/v1/partner/analytics/overview
 *
 * Returns per-establishment metrics with period comparison.
 */
export const getOverview = async (partnerId, { period, from, to }) => {
  const { startDate, endDate, prevStart, prevEnd } = parsePeriod(period, from, to);

  const establishments = await PartnerAnalyticsModel.getPartnerEstablishments(partnerId);

  if (establishments.length === 0) {
    return { establishments: [] };
  }

  const ids = establishments.map(e => e.id);

  const [metricsNow, metricsPrev, reviewsNow, reviewsPrev] = await Promise.all([
    PartnerAnalyticsModel.getMetricsInPeriod(ids, startDate, endDate),
    PartnerAnalyticsModel.getMetricsInPeriod(ids, prevStart, prevEnd),
    PartnerAnalyticsModel.getReviewMetricsInPeriod(ids, startDate, endDate),
    PartnerAnalyticsModel.getReviewMetricsInPeriod(ids, prevStart, prevEnd),
  ]);

  const empty = { views: 0, favorites: 0, calls: 0 };
  const emptyReviews = { reviews: 0, average_rating: 0 };

  const result = establishments.map(est => {
    const now = metricsNow[est.id] || empty;
    const prev = metricsPrev[est.id] || empty;
    const revNow = reviewsNow[est.id] || emptyReviews;
    const revPrev = reviewsPrev[est.id] || emptyReviews;

    return {
      establishment_id: est.id,
      establishment_name: est.name,
      period: {
        from: startDate.toISOString().split('T')[0],
        to: endDate.toISOString().split('T')[0],
        aggregation: getAggregationType(startDate, endDate),
      },
      views: {
        total: est.view_count,
        in_period: now.views,
        change_percent: computeChangePercent(now.views, prev.views),
      },
      favorites: {
        total: est.favorite_count,
        in_period: now.favorites,
        change_percent: computeChangePercent(now.favorites, prev.favorites),
      },
      calls: {
        total: 0, // No cumulative call counter on establishments table
        in_period: now.calls,
        change_percent: computeChangePercent(now.calls, prev.calls),
      },
      reviews: {
        total: est.review_count,
        in_period: revNow.reviews,
        change_percent: computeChangePercent(revNow.reviews, revPrev.reviews),
        average_rating: parseFloat(est.average_rating) || 0,
      },
    };
  });

  return { establishments: result };
};

/**
 * GET /api/v1/partner/analytics/trends
 *
 * Returns time-series for charts (views, favorites, calls, reviews).
 * Uses fillDateGaps for continuous series.
 */
export const getTrends = async (partnerId, establishmentId, { period, from, to }) => {
  // Verify ownership
  const isOwner = await PartnerAnalyticsModel.verifyOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError('Establishment not found or access denied', 404, 'NOT_FOUND');
  }

  const { startDate, endDate } = parsePeriod(period, from, to);
  const aggregation = getAggregationType(startDate, endDate);

  const [eventRows, reviewRows] = await Promise.all([
    PartnerAnalyticsModel.getEventTimeline(establishmentId, startDate, endDate, aggregation),
    PartnerAnalyticsModel.getReviewTimeline(establishmentId, startDate, endDate, aggregation),
  ]);

  // Transform event rows into separate trend arrays with gap filling
  const viewsData = eventRows.map(r => ({ date: r.date, count: r.views }));
  const favoritesData = eventRows.map(r => ({ date: r.date, count: r.favorites }));
  const callsData = eventRows.map(r => ({ date: r.date, count: r.calls }));

  const views_trend = fillDateGaps(viewsData, startDate, endDate, aggregation);
  const favorites_trend = fillDateGaps(favoritesData, startDate, endDate, aggregation);
  const calls_trend = fillDateGaps(callsData, startDate, endDate, aggregation);
  const reviews_trend = fillDateGaps(reviewRows, startDate, endDate, aggregation, ['avg_rating']);

  return {
    views_trend,
    favorites_trend,
    calls_trend,
    reviews_trend,
    aggregation,
  };
};

/**
 * GET /api/v1/partner/analytics/ratings
 *
 * Returns rating distribution for a single establishment.
 */
export const getRatings = async (partnerId, establishmentId) => {
  const isOwner = await PartnerAnalyticsModel.verifyOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError('Establishment not found or access denied', 404, 'NOT_FOUND');
  }

  return PartnerAnalyticsModel.getRatingDistribution(establishmentId);
};
