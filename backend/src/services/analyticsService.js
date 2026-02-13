/**
 * Analytics Service
 *
 * Business logic for admin analytics endpoints:
 * - Period parsing (7d/30d/90d/custom) with comparison period
 * - Auto-aggregation (day/week/month) based on period duration
 * - Date gap filling for continuous chart series
 * - Percentage change calculation with null-safe division
 *
 * Read-only — queries existing tables, creates no new data.
 */

import * as AnalyticsModel from '../models/analyticsModel.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

// ============================================================================
// Period Utilities
// ============================================================================

/**
 * Parse period parameter into date ranges for current and comparison periods.
 *
 * Supported formats:
 *   '7d', '30d', '90d' — last N days
 *   custom from/to in ISO format — arbitrary range
 *
 * @param {string} period - Period code (e.g. '30d')
 * @param {string} [from] - ISO date for custom range start
 * @param {string} [to] - ISO date for custom range end
 * @returns {{ startDate: Date, endDate: Date, prevStart: Date, prevEnd: Date }}
 */
export const parsePeriod = (period, from, to) => {
  let startDate, endDate;

  if (from && to) {
    startDate = new Date(from);
    endDate = new Date(to);
    // endDate should be end-of-day inclusive
    endDate.setHours(23, 59, 59, 999);
    // Move to next day start for < comparison
    endDate = new Date(endDate.getTime() + 1);
  } else {
    const days = parseInt(period, 10) || 30;
    endDate = new Date();
    startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
  }

  // Comparison period: same duration immediately preceding
  const durationMs = endDate.getTime() - startDate.getTime();
  const prevEnd = new Date(startDate.getTime());
  const prevStart = new Date(startDate.getTime() - durationMs);

  return { startDate, endDate, prevStart, prevEnd };
};

/**
 * Determine aggregation type based on period duration.
 *   <= 30 days → 'day'
 *   31-90 days → 'week'
 *   > 90 days  → 'month'
 */
export const getAggregationType = (startDate, endDate) => {
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  if (days <= 30) return 'day';
  if (days <= 90) return 'week';
  return 'month';
};

/**
 * Compute percentage change between current and previous period values.
 * Returns null when previous is 0 (avoids Infinity).
 */
export const computeChangePercent = (current, previous) => {
  if (previous === 0) return current > 0 ? null : 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
};

/**
 * Fill date gaps in timeline data so charts get a continuous series.
 * Iterates from startDate to endDate, inserting zero-count entries
 * for dates missing from the SQL result.
 *
 * @param {Array} data - Rows from SQL with { date, count, ... }
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} aggregation - 'day', 'week', or 'month'
 * @param {Array<string>} extraFields - Additional fields to zero-fill (e.g. ['average_rating'])
 */
export const fillDateGaps = (data, startDate, endDate, aggregation, extraFields = []) => {
  const dataMap = new Map();
  for (const row of data) {
    const key = formatDate(new Date(row.date));
    dataMap.set(key, row);
  }

  const result = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    const key = formatDate(current);
    if (dataMap.has(key)) {
      const row = dataMap.get(key);
      result.push({
        date: key,
        count: row.count,
        ...Object.fromEntries(extraFields.map(f => [f, row[f] != null ? parseFloat(row[f]) : null])),
      });
    } else {
      result.push({
        date: key,
        count: 0,
        ...Object.fromEntries(extraFields.map(f => [f, null])),
      });
    }

    // Advance by aggregation step
    if (aggregation === 'month') {
      current.setMonth(current.getMonth() + 1);
    } else if (aggregation === 'week') {
      current.setDate(current.getDate() + 7);
    } else {
      current.setDate(current.getDate() + 1);
    }
  }

  return result;
};

/**
 * Format date as YYYY-MM-DD string
 */
const formatDate = (date) => {
  return date.toISOString().split('T')[0];
};

// ============================================================================
// Endpoint Orchestrators
// ============================================================================

/**
 * Dashboard overview metrics
 * GET /api/v1/admin/analytics/overview
 */
export const getOverview = async ({ period, from, to }) => {
  const { startDate, endDate, prevStart, prevEnd } = parsePeriod(period, from, to);

  try {
    const [
      totalUsers,
      usersInPeriod,
      usersInPrev,
      establishmentCounts,
      establishmentsInPrev,
      reviewCounts,
      reviewsInPrev,
      moderationCounts,
    ] = await Promise.all([
      AnalyticsModel.countTotalUsers(),
      AnalyticsModel.countUsersInPeriod(startDate, endDate),
      AnalyticsModel.countUsersInPeriod(prevStart, prevEnd),
      AnalyticsModel.getEstablishmentCounts(startDate, endDate),
      AnalyticsModel.countEstablishmentsInPeriod(prevStart, prevEnd),
      AnalyticsModel.getReviewCounts(startDate, endDate),
      AnalyticsModel.countReviewsInPeriod(prevStart, prevEnd),
      AnalyticsModel.getModerationCounts(startDate, endDate),
    ]);

    return {
      users: {
        total: totalUsers,
        new_in_period: usersInPeriod,
        change_percent: computeChangePercent(usersInPeriod, usersInPrev),
      },
      establishments: {
        total: establishmentCounts.total,
        active: establishmentCounts.active,
        pending: establishmentCounts.pending,
        suspended: establishmentCounts.suspended,
        new_in_period: establishmentCounts.new_in_period,
        change_percent: computeChangePercent(
          establishmentCounts.new_in_period,
          establishmentsInPrev,
        ),
      },
      reviews: {
        total: reviewCounts.total,
        new_in_period: reviewCounts.new_in_period,
        change_percent: computeChangePercent(reviewCounts.new_in_period, reviewsInPrev),
        average_rating: parseFloat(reviewCounts.average_rating),
      },
      moderation: {
        pending_count: moderationCounts.pending_count,
        actions_in_period: moderationCounts.actions_in_period,
      },
    };
  } catch (error) {
    logger.error('Error in getOverview', { error: error.message });
    throw new AppError('Failed to fetch overview analytics', 500, 'OVERVIEW_FAILED');
  }
};

/**
 * Users analytics
 * GET /api/v1/admin/analytics/users
 */
export const getUsersAnalytics = async ({ period, from, to }) => {
  const { startDate, endDate, prevStart, prevEnd } = parsePeriod(period, from, to);
  const aggregation = getAggregationType(startDate, endDate);

  try {
    const [
      timelineRaw,
      roleDistribution,
      totalUsers,
      usersInPeriod,
      usersInPrev,
    ] = await Promise.all([
      AnalyticsModel.getUserRegistrationTimeline(startDate, endDate, aggregation),
      AnalyticsModel.getRoleDistribution(),
      AnalyticsModel.countTotalUsers(),
      AnalyticsModel.countUsersInPeriod(startDate, endDate),
      AnalyticsModel.countUsersInPeriod(prevStart, prevEnd),
    ]);

    const registration_timeline = fillDateGaps(timelineRaw, startDate, endDate, aggregation);

    return {
      registration_timeline,
      role_distribution: roleDistribution,
      total: totalUsers,
      new_in_period: usersInPeriod,
      change_percent: computeChangePercent(usersInPeriod, usersInPrev),
      aggregation,
    };
  } catch (error) {
    logger.error('Error in getUsersAnalytics', { error: error.message });
    throw new AppError('Failed to fetch users analytics', 500, 'USERS_ANALYTICS_FAILED');
  }
};

/**
 * Establishments analytics
 * GET /api/v1/admin/analytics/establishments
 */
export const getEstablishmentsAnalytics = async ({ period, from, to }) => {
  const { startDate, endDate, prevStart, prevEnd } = parsePeriod(period, from, to);
  const aggregation = getAggregationType(startDate, endDate);

  try {
    const [
      timelineRaw,
      statusDistribution,
      cityDistribution,
      categoryDistribution,
      counts,
      prevCount,
    ] = await Promise.all([
      AnalyticsModel.getEstablishmentCreationTimeline(startDate, endDate, aggregation),
      AnalyticsModel.getStatusDistribution(),
      AnalyticsModel.getCityDistribution(),
      AnalyticsModel.getCategoryDistribution(),
      AnalyticsModel.getEstablishmentCounts(startDate, endDate),
      AnalyticsModel.countEstablishmentsInPeriod(prevStart, prevEnd),
    ]);

    const creation_timeline = fillDateGaps(timelineRaw, startDate, endDate, aggregation);

    return {
      creation_timeline,
      status_distribution: statusDistribution,
      city_distribution: cityDistribution,
      category_distribution: categoryDistribution,
      total: counts.total,
      active: counts.active,
      new_in_period: counts.new_in_period,
      change_percent: computeChangePercent(counts.new_in_period, prevCount),
      aggregation,
    };
  } catch (error) {
    logger.error('Error in getEstablishmentsAnalytics', { error: error.message });
    throw new AppError('Failed to fetch establishments analytics', 500, 'ESTABLISHMENTS_ANALYTICS_FAILED');
  }
};

/**
 * Reviews analytics
 * GET /api/v1/admin/analytics/reviews
 */
export const getReviewsAnalytics = async ({ period, from, to }) => {
  const { startDate, endDate, prevStart, prevEnd } = parsePeriod(period, from, to);
  const aggregation = getAggregationType(startDate, endDate);

  try {
    const [
      timelineRaw,
      ratingDistribution,
      responseStats,
      reviewCounts,
      prevCount,
    ] = await Promise.all([
      AnalyticsModel.getReviewTimeline(startDate, endDate, aggregation),
      AnalyticsModel.getGlobalRatingDistribution(),
      AnalyticsModel.getResponseStats(),
      AnalyticsModel.getReviewCounts(startDate, endDate),
      AnalyticsModel.countReviewsInPeriod(prevStart, prevEnd),
    ]);

    const review_timeline = fillDateGaps(
      timelineRaw, startDate, endDate, aggregation, ['average_rating'],
    );

    return {
      review_timeline,
      rating_distribution: ratingDistribution,
      response_stats: {
        total_with_response: responseStats.total_with_response,
        response_rate: parseFloat(responseStats.response_rate),
        avg_response_time_hours: parseFloat(responseStats.avg_response_time_hours),
      },
      total: reviewCounts.total,
      new_in_period: reviewCounts.new_in_period,
      change_percent: computeChangePercent(reviewCounts.new_in_period, prevCount),
      aggregation,
    };
  } catch (error) {
    logger.error('Error in getReviewsAnalytics', { error: error.message });
    throw new AppError('Failed to fetch reviews analytics', 500, 'REVIEWS_ANALYTICS_FAILED');
  }
};
