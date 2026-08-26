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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Midnight of the calendar day the value falls on, in UTC.
 *
 * UTC, not process-local, on purpose: `created_at` columns are naive timestamps
 * holding UTC, and every timeline groups by `DATE(created_at)` — i.e. by UTC
 * calendar days. Deriving window bounds from the process timezone would measure
 * the window with one ruler and bucket it with another. On production (UTC) the
 * two rulers coincide, so the divergence is invisible there and shows up only on
 * a developer's machine — the quietest kind of defect.
 *
 * Accepts 'YYYY-MM-DD', a full ISO string, or a Date.
 */
const startOfUtcDay = (value, label) => {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value));
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    // Round-trip check. `Date.UTC` happily rolls over: '2026-13-45' becomes
    // 14 February 2027 — a real date, silently answering a question nobody
    // asked. Before this guard the same input threw and produced a 500; now it
    // is refused by name instead of either lying or crashing.
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new AppError(`Invalid ${label} date: ${value}`, 400, 'INVALID_PERIOD');
    }
    return date;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid ${label} date: ${value}`, 400, 'INVALID_PERIOD');
  }
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
};

/**
 * Parse period parameter into date ranges for current and comparison periods.
 *
 * Supported formats:
 *   '7d', '30d', '90d' — last N days, ending with today
 *   custom from/to     — 'YYYY-MM-DD' bounds, both days included
 *
 * The returned window is half-open: `startDate <= created_at < endDate`, always
 * a whole number of UTC days. `'30d'` therefore means thirty day-buckets, not
 * thirty-and-a-bit: the previous edition took the current instant as the upper
 * bound, which made the range ~30.5 days long and pushed `getAggregationType`
 * to hand back weekly buckets for a period the interface calls «30 дней».
 *
 * @param {string} period - Period code (e.g. '30d')
 * @param {string} [from] - Custom range start (inclusive day)
 * @param {string} [to] - Custom range end (inclusive day)
 * @returns {{ startDate: Date, endDate: Date, prevStart: Date, prevEnd: Date }}
 */
export const parsePeriod = (period, from, to) => {
  let startDate, endDate;

  if (from && to) {
    startDate = startOfUtcDay(from, 'from');
    // `to` names the last day of the window, so the exclusive bound is the
    // midnight after it — otherwise the day the moderator asked for is the one
    // day they do not get.
    endDate = new Date(startOfUtcDay(to, 'to').getTime() + MS_PER_DAY);

    if (startDate >= endDate) {
      // An inverted range used to answer 200 with an empty window and a header
      // reading «10 — 1 августа»: a question refused is better than an answer
      // that looks like data.
      throw new AppError(
        `Period start ${from} is after end ${to}`, 400, 'INVALID_PERIOD',
      );
    }
  } else {
    const days = parseInt(period, 10) || 30;
    if (days <= 0) {
      throw new AppError(`Invalid period: ${period}`, 400, 'INVALID_PERIOD');
    }
    endDate = new Date(startOfUtcDay(new Date(), 'today').getTime() + MS_PER_DAY);
    startDate = new Date(endDate.getTime() - days * MS_PER_DAY);
  }

  // Comparison period: same duration immediately preceding
  const durationMs = endDate.getTime() - startDate.getTime();
  const prevEnd = new Date(startDate.getTime());
  const prevStart = new Date(startDate.getTime() - durationMs);

  return { startDate, endDate, prevStart, prevEnd };
};

/**
 * The resolved window, as the interface should report it.
 *
 * Sent on every analytics response so the screen header states the window the
 * query actually used instead of recomputing it. A client-side mirror of the
 * arithmetic above would drift for two reasons: it would have to guess the
 * server's idea of «today», and a tab left open overnight would keep printing
 * yesterday's window over today's numbers.
 *
 * `end` is exclusive — the same bound the SQL uses.
 */
const periodBounds = (startDate, endDate) => ({
  start: startDate.toISOString(),
  end: endDate.toISOString(),
});

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
    dataMap.set(rowDateKey(row.date), row);
  }

  const result = [];
  let current = bucketStart(startDate, aggregation);

  while (current < endDate) {
    const key = formatUtcDay(current);
    const row = dataMap.get(key);
    result.push({
      date: key,
      count: row ? row.count : 0,
      ...Object.fromEntries(extraFields.map(
        f => [f, row && row[f] != null ? parseFloat(row[f]) : null],
      )),
    });

    current = advanceBucket(current, aggregation);
  }

  return result;
};

/**
 * Start of the bucket a date falls into — mirroring what SQL groups by.
 *
 * This has to mirror `DATE_TRUNC` exactly, and that is the whole point. The
 * previous edition stepped forward from `startDate` itself, whatever weekday it
 * happened to be, while SQL handed back Mondays (`DATE_TRUNC('week')`) and
 * first-of-months. The two key spaces never intersected, so every weekly and
 * monthly chart in the product — admin and partner alike — rendered a flat zero
 * line while the metric card beside it showed a non-zero count.
 *
 * Postgres weeks are ISO weeks: they start on Monday.
 */
const bucketStart = (date, aggregation) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (aggregation === 'month') return new Date(Date.UTC(year, month, 1));

  const dayStart = new Date(Date.UTC(year, month, day));
  if (aggregation !== 'week') return dayStart;

  const sinceMonday = (dayStart.getUTCDay() + 6) % 7;
  return new Date(dayStart.getTime() - sinceMonday * MS_PER_DAY);
};

const advanceBucket = (date, aggregation) => {
  if (aggregation === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }
  return new Date(date.getTime() + (aggregation === 'week' ? 7 : 1) * MS_PER_DAY);
};

const pad = (n) => String(n).padStart(2, '0');

/** Calendar day as YYYY-MM-DD, read in UTC. */
const formatUtcDay = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/**
 * The calendar day a SQL row is labelled with.
 *
 * node-pg turns a DATE column into a Date at LOCAL midnight, so the calendar
 * day the database meant has to be read back with local getters. Reading it
 * through `toISOString()` — as this function used to — shifts the key a day
 * backwards on any process east of UTC, which on production (UTC) is invisible
 * and on a developer's machine silently relabels every column.
 */
const rowDateKey = (value) => {
  if (typeof value === 'string') return value.slice(0, 10);
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
        // ISO-строка или null. Возраст считает клиент — так подпись
        // «старейшая ждёт N дней» не устаревает между запросами.
        oldest_pending_at: moderationCounts.oldest_pending_at
          ? new Date(moderationCounts.oldest_pending_at).toISOString()
          : null,
      },
      period: periodBounds(startDate, endDate),
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
      period: periodBounds(startDate, endDate),
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
      // Очередь модерации. Считалась этим же запросом с самого начала и
      // отдавалась только на дашборде — вкладке «Заведения» она нужна ровно
      // так же, а второй запрос за уже посчитанным числом был бы лишним.
      pending: counts.pending,
      new_in_period: counts.new_in_period,
      change_percent: computeChangePercent(counts.new_in_period, prevCount),
      aggregation,
      period: periodBounds(startDate, endDate),
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
        // Знаменатель едет вместе с числителем. Карточка ответов показывает
        // долю, число ответивших и число оставшихся без ответа — все три
        // обязаны быть посчитаны по одной выборке, иначе подпись складывается
        // из ответов на разные вопросы (то же правило, что у `getReviewStats`).
        total_reviews: responseStats.total_reviews,
        total_with_response: responseStats.total_with_response,
        response_rate: parseFloat(responseStats.response_rate),
        avg_response_time_hours: parseFloat(responseStats.avg_response_time_hours),
      },
      total: reviewCounts.total,
      new_in_period: reviewCounts.new_in_period,
      change_percent: computeChangePercent(reviewCounts.new_in_period, prevCount),
      // Средняя оценка считалась этим же запросом и уходила только в
      // `overview`. Вкладке «Отзывы» она нужна метрикой первого ряда.
      average_rating: parseFloat(reviewCounts.average_rating),
      aggregation,
      period: periodBounds(startDate, endDate),
    };
  } catch (error) {
    logger.error('Error in getReviewsAnalytics', { error: error.message });
    throw new AppError('Failed to fetch reviews analytics', 500, 'REVIEWS_ANALYTICS_FAILED');
  }
};
