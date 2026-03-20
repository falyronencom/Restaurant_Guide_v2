/**
 * Partner Analytics Model
 *
 * SQL queries for partner-facing analytics.
 * Reads from establishment_analytics (per-day event counters)
 * and reviews (for review metrics scoped to partner establishments).
 *
 * Tables: establishment_analytics, establishments, reviews
 * Write operations: UPSERT into establishment_analytics (event tracking)
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

// ============================================================================
// Event Tracking (UPSERT into establishment_analytics)
// ============================================================================

/**
 * UPSERT a view event for an establishment on the current date.
 * Creates a new row if none exists for today, otherwise increments.
 *
 * @param {string} establishmentId - UUID of the establishment
 */
export const trackView = async (establishmentId) => {
  const query = `
    INSERT INTO establishment_analytics (establishment_id, date, view_count)
    VALUES ($1, CURRENT_DATE, 1)
    ON CONFLICT (establishment_id, date)
    DO UPDATE SET view_count = establishment_analytics.view_count + 1
  `;
  try {
    await pool.query(query, [establishmentId]);
  } catch (error) {
    logger.error('Error tracking view in analytics', {
      error: error.message,
      establishmentId,
    });
  }
};

/**
 * UPSERT a favorite event (+1 on add, -1 on remove).
 * Ensures favorite_count never goes below 0.
 *
 * @param {string} establishmentId - UUID
 * @param {number} delta - +1 for add, -1 for remove
 */
export const trackFavorite = async (establishmentId, delta) => {
  const query = `
    INSERT INTO establishment_analytics (establishment_id, date, favorite_count)
    VALUES ($1, CURRENT_DATE, GREATEST($2, 0))
    ON CONFLICT (establishment_id, date)
    DO UPDATE SET favorite_count = GREATEST(
      establishment_analytics.favorite_count + $2, 0
    )
  `;
  try {
    await pool.query(query, [establishmentId, delta]);
  } catch (error) {
    logger.error('Error tracking favorite in analytics', {
      error: error.message,
      establishmentId,
      delta,
    });
  }
};

/**
 * UPSERT a phone call click event.
 *
 * @param {string} establishmentId - UUID
 */
export const trackCall = async (establishmentId) => {
  const query = `
    INSERT INTO establishment_analytics (establishment_id, date, call_count)
    VALUES ($1, CURRENT_DATE, 1)
    ON CONFLICT (establishment_id, date)
    DO UPDATE SET call_count = establishment_analytics.call_count + 1
  `;
  try {
    await pool.query(query, [establishmentId]);
  } catch (error) {
    logger.error('Error tracking call in analytics', {
      error: error.message,
      establishmentId,
    });
  }
};

// ============================================================================
// Partner Analytics Queries
// ============================================================================

/**
 * Get aggregated metrics from establishment_analytics for a set of
 * establishment IDs within a date range.
 *
 * @param {string[]} establishmentIds - UUIDs
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Object} Map of establishment_id → { views, favorites, calls }
 */
export const getMetricsInPeriod = async (establishmentIds, startDate, endDate) => {
  if (establishmentIds.length === 0) return {};

  const query = `
    SELECT
      establishment_id,
      COALESCE(SUM(view_count), 0)::int AS views,
      COALESCE(SUM(favorite_count), 0)::int AS favorites,
      COALESCE(SUM(call_count), 0)::int AS calls
    FROM establishment_analytics
    WHERE establishment_id = ANY($1)
      AND date >= $2 AND date < $3
    GROUP BY establishment_id
  `;
  try {
    const result = await pool.query(query, [establishmentIds, startDate, endDate]);
    const map = {};
    for (const row of result.rows) {
      map[row.establishment_id] = {
        views: row.views,
        favorites: row.favorites,
        calls: row.calls,
      };
    }
    return map;
  } catch (error) {
    logger.error('Error getting metrics in period', { error: error.message });
    throw error;
  }
};

/**
 * Get review metrics for partner establishments in a date range.
 *
 * @param {string[]} establishmentIds
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Object} Map of establishment_id → { reviews, average_rating }
 */
export const getReviewMetricsInPeriod = async (establishmentIds, startDate, endDate) => {
  if (establishmentIds.length === 0) return {};

  const query = `
    SELECT
      establishment_id,
      COUNT(*)::int AS reviews,
      COALESCE(AVG(rating)::DECIMAL(3,2), 0) AS average_rating
    FROM reviews
    WHERE establishment_id = ANY($1)
      AND is_deleted = false AND is_visible = true
      AND created_at >= $2 AND created_at < $3
    GROUP BY establishment_id
  `;
  try {
    const result = await pool.query(query, [establishmentIds, startDate, endDate]);
    const map = {};
    for (const row of result.rows) {
      map[row.establishment_id] = {
        reviews: row.reviews,
        average_rating: parseFloat(row.average_rating),
      };
    }
    return map;
  } catch (error) {
    logger.error('Error getting review metrics in period', { error: error.message });
    throw error;
  }
};

/**
 * Get time-series data from establishment_analytics for one establishment.
 * Uses DATE_TRUNC for week/month aggregation.
 *
 * @param {string} establishmentId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} truncTo - 'day', 'week', or 'month'
 * @returns {{ views: Array, favorites: Array, calls: Array }}
 */
export const getEventTimeline = async (establishmentId, startDate, endDate, truncTo = 'day') => {
  const truncExpr = truncTo === 'day'
    ? 'DATE(date)'
    : `DATE(DATE_TRUNC('${truncTo}', date))`;

  const query = `
    SELECT
      ${truncExpr} AS date,
      COALESCE(SUM(view_count), 0)::int AS views,
      COALESCE(SUM(favorite_count), 0)::int AS favorites,
      COALESCE(SUM(call_count), 0)::int AS calls
    FROM establishment_analytics
    WHERE establishment_id = $1
      AND date >= $2 AND date < $3
    GROUP BY 1
    ORDER BY 1
  `;
  try {
    const result = await pool.query(query, [establishmentId, startDate, endDate]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting event timeline', { error: error.message });
    throw error;
  }
};

/**
 * Get review timeline for one establishment (count + avg rating per period).
 *
 * @param {string} establishmentId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} truncTo
 */
export const getReviewTimeline = async (establishmentId, startDate, endDate, truncTo = 'day') => {
  const truncExpr = truncTo === 'day'
    ? 'DATE(created_at)'
    : `DATE(DATE_TRUNC('${truncTo}', created_at))`;

  const query = `
    SELECT
      ${truncExpr} AS date,
      COUNT(*)::int AS count,
      AVG(rating)::DECIMAL(3,2) AS avg_rating
    FROM reviews
    WHERE establishment_id = $1
      AND is_deleted = false AND is_visible = true
      AND created_at >= $2 AND created_at < $3
    GROUP BY 1
    ORDER BY 1
  `;
  try {
    const result = await pool.query(query, [establishmentId, startDate, endDate]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting review timeline', { error: error.message });
    throw error;
  }
};

/**
 * Get rating distribution for a single establishment.
 *
 * @param {string} establishmentId
 * @returns {{ distribution: Array, average: number, total_reviews: number }}
 */
export const getRatingDistribution = async (establishmentId) => {
  const query = `
    SELECT rating, COUNT(*)::int AS count
    FROM reviews
    WHERE establishment_id = $1
      AND is_deleted = false AND is_visible = true
    GROUP BY rating
    ORDER BY rating
  `;
  try {
    const result = await pool.query(query, [establishmentId]);

    const distribution = [];
    const totalReviews = result.rows.reduce((sum, row) => sum + row.count, 0);

    for (let r = 1; r <= 5; r++) {
      const row = result.rows.find(row => row.rating === r);
      const count = row ? row.count : 0;
      const percentage = totalReviews > 0
        ? parseFloat(((count / totalReviews) * 100).toFixed(1))
        : 0;
      distribution.push({ rating: r, count, percentage });
    }

    const average = totalReviews > 0
      ? parseFloat(
        (result.rows.reduce((sum, row) => sum + row.rating * row.count, 0) / totalReviews).toFixed(2),
      )
      : 0;

    return { distribution, average, total_reviews: totalReviews };
  } catch (error) {
    logger.error('Error getting rating distribution', { error: error.message });
    throw error;
  }
};

/**
 * Get partner's establishment IDs and basic info.
 * Used by analytics service to scope queries to partner-owned establishments.
 *
 * @param {string} partnerId
 * @returns {Array<{ id: string, name: string, view_count: number, favorite_count: number, review_count: number, average_rating: number }>}
 */
export const getPartnerEstablishments = async (partnerId) => {
  const query = `
    SELECT
      id,
      name,
      view_count,
      favorite_count,
      review_count,
      COALESCE(average_rating::DECIMAL(3,2), 0) AS average_rating
    FROM establishments
    WHERE partner_id = $1
      AND status IN ('active', 'suspended')
    ORDER BY name
  `;
  try {
    const result = await pool.query(query, [partnerId]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting partner establishments for analytics', { error: error.message });
    throw error;
  }
};

/**
 * Verify that an establishment belongs to a specific partner.
 *
 * @param {string} establishmentId
 * @param {string} partnerId
 * @returns {boolean}
 */
export const verifyOwnership = async (establishmentId, partnerId) => {
  const query = `
    SELECT 1 FROM establishments
    WHERE id = $1 AND partner_id = $2
    LIMIT 1
  `;
  try {
    const result = await pool.query(query, [establishmentId, partnerId]);
    return result.rows.length > 0;
  } catch (error) {
    logger.error('Error verifying establishment ownership', { error: error.message });
    throw error;
  }
};
