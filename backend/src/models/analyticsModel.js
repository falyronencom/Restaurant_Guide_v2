/**
 * Analytics Model
 *
 * Read-only SQL aggregation queries for admin analytics dashboard.
 * All queries are parameterized — no string interpolation for dates/periods.
 *
 * Tables queried: users, establishments, reviews, audit_log
 * No writes, no mutations, no new tables.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

// ============================================================================
// Overview (Dashboard) Metrics
// ============================================================================

/**
 * Count users created within a date range
 */
export const countUsersInPeriod = async (startDate, endDate) => {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM users
    WHERE created_at >= $1 AND created_at < $2
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows[0].count;
  } catch (error) {
    logger.error('Error counting users in period', { error: error.message });
    throw error;
  }
};

/**
 * Count total users
 */
export const countTotalUsers = async () => {
  // Только действующие учётные записи. Удалённая остаётся в базе пустой
  // оболочкой (accountDeletionService: id, роль, дата, is_active = false), а
  // заблокированная — тоже is_active = false; в «Всего» и «Партнёров» они
  // попадали, и удаление партнёра число не уменьшало (проход по панели
  // модератора, 20.10, A3-20). Новые за период считаются по регистрациям, как
  // прежде: человек зарегистрировался, даже если потом ушёл.
  const query = `SELECT COUNT(*)::int AS count FROM users WHERE is_active = TRUE`;
  try {
    const result = await pool.query(query);
    return result.rows[0].count;
  } catch (error) {
    logger.error('Error counting total users', { error: error.message });
    throw error;
  }
};

/**
 * Count establishments by status and within a date range
 */
export const getEstablishmentCounts = async (startDate, endDate) => {
  const query = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended,
      COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS new_in_period
    FROM establishments
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error getting establishment counts', { error: error.message });
    throw error;
  }
};

/**
 * Count establishments created in a previous period (for comparison)
 */
export const countEstablishmentsInPeriod = async (startDate, endDate) => {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM establishments
    WHERE created_at >= $1 AND created_at < $2
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows[0].count;
  } catch (error) {
    logger.error('Error counting establishments in period', { error: error.message });
    throw error;
  }
};

/**
 * Count reviews and average rating within a date range
 */
export const getReviewCounts = async (startDate, endDate) => {
  const query = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS new_in_period,
      COALESCE(AVG(rating)::DECIMAL(3,2), 0) AS average_rating
    FROM reviews
    WHERE is_deleted = false AND is_visible = true
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error getting review counts', { error: error.message });
    throw error;
  }
};

/**
 * Count reviews in a date range (for comparison)
 */
export const countReviewsInPeriod = async (startDate, endDate) => {
  const query = `
    SELECT COUNT(*)::int AS count
    FROM reviews
    WHERE is_deleted = false AND is_visible = true
      AND created_at >= $1 AND created_at < $2
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows[0].count;
  } catch (error) {
    logger.error('Error counting reviews in period', { error: error.message });
    throw error;
  }
};

/**
 * Count pending moderation items and moderation actions in period
 */
export const getModerationCounts = async (startDate, endDate) => {
  // oldest_pending_at считается здесь, а не отдельным запросом: фронт видит
  // очередь страницами по 20 и максимума по ней не знает, а лишний round-trip
  // ради одного скаляра не нужен. NULL при пустой очереди — это корректный
  // ответ «ждать нечему», а не отсутствие данных.
  //
  // AT TIME ZONE 'UTC' обязателен. Колонка — timestamp WITHOUT time zone, и
  // NOW() пишет в неё UTC. node-pg разбирает наивную метку как ЛОКАЛЬНОЕ время
  // процесса, после чего toISOString() уезжает на смещение машины: на UTC+3
  // возраст заявки завышался ровно на три часа. На Railway процесс живёт в UTC,
  // поэтому в проде дефект невидим и проявляется только локально — что делает
  // его особенно неприятным. Конверсия в SQL снимает зависимость от TZ сервера.
  const query = `
    SELECT
      (SELECT COUNT(*)::int FROM establishments WHERE status = 'pending') AS pending_count,
      -- От последней правки карточки, а не от создания черновика — так же,
      -- как очередь «Ожидают просмотра» (решение Координатора 20.10, Б):
      -- черновик мог пролежать 20 дней до отправки, и главная говорила
      -- «старейшая ждёт 82 дня» о заявке, которая в очереди ждёт 21 (A3-19,
      -- Ч2). Отдельной отметки «отправлено» нет: отправка ставит updated_at.
      (
        SELECT MIN(updated_at) AT TIME ZONE 'UTC'
        FROM establishments WHERE status = 'pending'
      ) AS oldest_pending_at,
      -- Решения модератора по заведениям. Коды — те, что пишутся в журнал
      -- (adminService): 'suspend' и 'unsuspend'; прежние
      -- 'suspend_establishment' не писал никто, и приостановки не считались
      -- (A3-18). Без автора-человека 'suspend' пишет система (захват учётной
      -- записи) — это не решение модератора; пауза партнёра — свой код.
      (
        SELECT COUNT(*)::int FROM audit_log
        WHERE action IN ('moderate_approve', 'moderate_reject', 'suspend', 'unsuspend')
          AND user_id IS NOT NULL
          AND created_at >= $1 AND created_at < $2
      ) AS actions_in_period
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error getting moderation counts', { error: error.message });
    throw error;
  }
};

// ============================================================================
// Users Analytics
// ============================================================================

/**
 * User registration timeline grouped by date/week/month
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} truncTo - 'day', 'week', or 'month'
 */
export const getUserRegistrationTimeline = async (startDate, endDate, truncTo = 'day') => {
  const truncExpr = truncTo === 'day'
    ? 'DATE(created_at)'
    : `DATE(DATE_TRUNC('${truncTo}', created_at))`;

  const query = `
    SELECT ${truncExpr} AS date, COUNT(*)::int AS count
    FROM users
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY date
    ORDER BY date
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting user registration timeline', { error: error.message });
    throw error;
  }
};

/**
 * Current role distribution (snapshot, not period-filtered)
 */
export const getRoleDistribution = async () => {
  // Как «Всего пользователей»: только действующие учётные записи (A3-20),
  // иначе доли ролей не сходились бы с итогом.
  const query = `
    SELECT role, COUNT(*)::int AS count
    FROM users
    WHERE is_active = TRUE
    GROUP BY role
    ORDER BY count DESC
  `;
  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error getting role distribution', { error: error.message });
    throw error;
  }
};

// ============================================================================
// Establishments Analytics
// ============================================================================

/**
 * Establishment creation timeline grouped by date/week/month
 */
export const getEstablishmentCreationTimeline = async (startDate, endDate, truncTo = 'day') => {
  const truncExpr = truncTo === 'day'
    ? 'DATE(created_at)'
    : `DATE(DATE_TRUNC('${truncTo}', created_at))`;

  const query = `
    SELECT ${truncExpr} AS date, COUNT(*)::int AS count
    FROM establishments
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY date
    ORDER BY date
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting establishment creation timeline', { error: error.message });
    throw error;
  }
};

/**
 * Current status distribution (snapshot)
 */
export const getStatusDistribution = async () => {
  const query = `
    SELECT status, COUNT(*)::int AS count
    FROM establishments
    GROUP BY status
    ORDER BY count DESC
  `;
  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error getting status distribution', { error: error.message });
    throw error;
  }
};

/**
 * Current city distribution (snapshot)
 */
export const getCityDistribution = async () => {
  const query = `
    SELECT city, COUNT(*)::int AS count
    FROM establishments
    WHERE city IS NOT NULL
    GROUP BY city
    ORDER BY count DESC
  `;
  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error getting city distribution', { error: error.message });
    throw error;
  }
};

/**
 * Category distribution using UNNEST on PostgreSQL array field (snapshot)
 */
export const getCategoryDistribution = async () => {
  const query = `
    SELECT category, COUNT(*)::int AS count
    FROM (
      SELECT UNNEST(categories) AS category
      FROM establishments
      WHERE categories IS NOT NULL AND array_length(categories, 1) > 0
    ) sub
    GROUP BY category
    ORDER BY count DESC
  `;
  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Error getting category distribution', { error: error.message });
    throw error;
  }
};

// ============================================================================
// Reviews Analytics
// ============================================================================

/**
 * Review timeline with count and average rating per day/week/month
 */
export const getReviewTimeline = async (startDate, endDate, truncTo = 'day') => {
  const truncExpr = truncTo === 'day'
    ? 'DATE(created_at)'
    : `DATE(DATE_TRUNC('${truncTo}', created_at))`;

  const query = `
    SELECT
      ${truncExpr} AS date,
      COUNT(*)::int AS count,
      AVG(rating)::DECIMAL(3,2) AS average_rating
    FROM reviews
    WHERE is_deleted = false AND is_visible = true
      AND created_at >= $1 AND created_at < $2
    GROUP BY date
    ORDER BY date
  `;
  try {
    const result = await pool.query(query, [startDate, endDate]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting review timeline', { error: error.message });
    throw error;
  }
};

/**
 * Global rating distribution (adapted from reviewModel.getRatingDistribution)
 * Returns counts and percentages for ratings 1-5
 */
export const getGlobalRatingDistribution = async () => {
  const query = `
    SELECT rating, COUNT(*)::int AS count
    FROM reviews
    WHERE is_deleted = false AND is_visible = true
    GROUP BY rating
    ORDER BY rating
  `;
  try {
    const result = await pool.query(query);

    // Build full distribution with zeros for missing ratings
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

    // Ensure percentages sum to 100% by adjusting the largest slice
    if (totalReviews > 0) {
      const sum = distribution.reduce((s, d) => s + d.percentage, 0);
      const diff = parseFloat((100 - sum).toFixed(1));
      if (diff !== 0) {
        const maxItem = distribution.reduce((max, d) => d.count > max.count ? d : max);
        maxItem.percentage = parseFloat((maxItem.percentage + diff).toFixed(1));
      }
    }

    return distribution;
  } catch (error) {
    logger.error('Error getting global rating distribution', { error: error.message });
    throw error;
  }
};

/**
 * Partner response statistics
 * - total reviews with partner response
 * - response rate (ratio with response / total)
 * - average response time in hours
 */
export const getResponseStats = async () => {
  const query = `
    SELECT
      COUNT(*)::int AS total_reviews,
      COUNT(partner_response)::int AS total_with_response,
      CASE
        WHEN COUNT(*) > 0
        -- Четыре знака у доли — это два знака у процента; экран показывает
        -- один, и запас в разряд оставлен намеренно, чтобы округление делал
        -- он, а не SQL. При двух знаках 287 из 1240 схлопывались в 0.23, и
        -- «23,1%» было недостижимо: интерфейс печатал бы «23,0%» и расходился
        -- с делением, которое читатель может выполнить сам.
        THEN ROUND(COUNT(partner_response)::numeric / COUNT(*)::numeric, 4)
        ELSE 0
      END AS response_rate,
      COALESCE(
        ROUND(
          (AVG(
            EXTRACT(EPOCH FROM (partner_response_at - created_at)) / 3600
          ) FILTER (WHERE partner_response_at IS NOT NULL))::numeric,
          1
        ),
        0
      ) AS avg_response_time_hours
    FROM reviews
    WHERE is_deleted = false AND is_visible = true
  `;
  try {
    const result = await pool.query(query);
    return result.rows[0];
  } catch (error) {
    logger.error('Error getting response stats', { error: error.message });
    throw error;
  }
};
