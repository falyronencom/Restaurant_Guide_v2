/**
 * Admin Review Model
 *
 * Database access methods for admin review management.
 * Separate from reviewModel.js to avoid bloating the public review queries.
 * Admin queries include deleted/hidden reviews and JOIN with users + establishments.
 *
 * Segment E: Utility Screens
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { likeContains } from '../utils/likePattern.js';

/**
 * Build dynamic WHERE clause for admin review queries
 *
 * @param {Object} filters
 * @returns {{ whereClause: string, values: Array, paramIndex: number }}
 */
const buildReviewWhere = (filters) => {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (filters.establishment_id) {
    conditions.push(`r.establishment_id = $${paramIndex++}`);
    values.push(filters.establishment_id);
  }

  if (filters.user_id) {
    conditions.push(`r.user_id = $${paramIndex++}`);
    values.push(filters.user_id);
  }

  // The service has checked the three: whole numbers 1–5 (getReviews).
  if (filters.rating) {
    conditions.push(`r.rating = $${paramIndex++}`);
    values.push(filters.rating);
  }

  // A range — «оценка 1–2» of the analytics link (Chrome pass 20.10, p. 31).
  if (filters.rating_min) {
    conditions.push(`r.rating >= $${paramIndex++}`);
    values.push(filters.rating_min);
  }

  if (filters.rating_max) {
    conditions.push(`r.rating <= $${paramIndex++}`);
    values.push(filters.rating_max);
  }

  // A viewer — the read-only panel role shown to people outside the project —
  // never receives a deleted review, whoever deleted it (pack 2, point 1;
  // cloud critic 2A, B-1). The condition sits in the WHERE and not in a
  // post-filter so that the counters of getReviewStats agree with the list.
  if (filters.viewer) {
    conditions.push('r.is_deleted = false');
  }

  // Status mapping: visible, hidden, deleted
  if (filters.status === 'visible') {
    conditions.push('r.is_visible = true AND r.is_deleted = false');
  } else if (filters.status === 'hidden') {
    conditions.push('r.is_visible = false AND r.is_deleted = false');
  } else if (filters.status === 'deleted') {
    conditions.push('r.is_deleted = true');
  }
  // No filter = show all (including deleted and hidden)

  if (filters.search) {
    // For a viewer the search reads visible texts only: the text of a hidden
    // review is withheld from them, and a search over it would let the text be
    // guessed piece by piece from which queries match.
    // «%» and «_» are the moderator's characters, not wildcards: «100%»
    // finds the text «100%», not every review (walkthrough 20.10, A2-20).
    const searchCondition = `COALESCE(r.content, r.text, '') ILIKE $${paramIndex++} ESCAPE '\\'`;
    conditions.push(filters.viewer
      ? `(r.is_visible = true AND ${searchCondition})`
      : searchCondition);
    values.push(likeContains(filters.search));
  }

  if (filters.from) {
    conditions.push(`r.created_at >= $${paramIndex++}`);
    values.push(filters.from);
  }

  if (filters.to) {
    conditions.push(`r.created_at <= $${paramIndex++}`);
    values.push(filters.to);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return { whereClause, values, paramIndex };
};

/**
 * Get paginated reviews for admin management
 * Includes deleted/hidden reviews, author info, establishment info
 *
 * @param {Object} filters
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>}
 */
export const getAdminReviews = async (filters = {}, limit = 20, offset = 0) => {
  const { whereClause, values, paramIndex } = buildReviewWhere(filters);

  // Sort options. r.id is the last key of each: two reviews with the same
  // created_at (and rating) otherwise come in any order, and on the border of
  // two pages one may be shown twice and another not at all.
  const sortMap = {
    newest: 'r.created_at DESC, r.id DESC',
    oldest: 'r.created_at ASC, r.id ASC',
    rating_high: 'r.rating DESC, r.created_at DESC, r.id DESC',
    rating_low: 'r.rating ASC, r.created_at DESC, r.id DESC',
  };
  const orderBy = sortMap[filters.sort] || sortMap.newest;

  // A viewer sees author statistics over VISIBLE reviews only — as an
  // outsider would. Counting the hidden ones in would let the difference
  // between «reviews by this author» and their visible rows name how many are
  // hidden, and the hidden list (rating, place, date) would tie them to the
  // name (Phase 3.5 review of pack 2). Fixed SQL chosen by a boolean.
  const authorVisibility = filters.viewer ? 'AND ar.is_visible = TRUE' : '';

  const query = `
    SELECT
      r.id,
      r.rating,
      COALESCE(r.content, r.text) as content,
      r.is_deleted,
      r.is_visible,
      r.is_edited,
      -- AT TIME ZONE 'UTC' обязателен. Колонка — timestamp WITHOUT time zone,
      -- и node-pg читает такую метку как местное время СВОЕГО процесса. В
      -- проде (TZ=UTC) это совпадает с хранимым, а на машине разработчика
      -- уезжает на его часовой пояс — дефект, невидимый именно там, где его
      -- ловят. Каст в timestamptz снимает вопрос для любого клиента.
      r.created_at AT TIME ZONE 'UTC' as created_at,
      r.partner_response,
      r.partner_response_at,
      CASE WHEN r.partner_response IS NOT NULL THEN true ELSE false END as has_partner_response,
      r.user_id as author_id,
      u.name as author_name,
      u.email as author_email,
      e.name as establishment_name,
      e.city as establishment_city,
      e.id as establishment_id,
      -- Рейтинг заведения — по ВИДИМЫМ неудалённым отзывам.
      -- Триггер update_metrics_after_review пишет в те же колонки значение по
      -- всем неудалённым, но последнее слово не за ним: на каждом пути записи
      -- следом вызывается ReviewModel.updateEstablishmentAggregates, а она
      -- фильтрует ещё и is_visible = true. Скрытый отзыв здесь не участвует —
      -- на это опирается клиентский расчёт «без этого отзыва».
      -- float8, а не numeric: node-pg отдаёт NUMERIC строкой.
      e.average_rating::float8 as establishment_average_rating,
      e.review_count as establishment_review_count,
      author.review_count as author_review_count,
      author.average_rating::float8 as author_average_rating,
      -- Заблокирован ли автор: «Показать» на его отзыве вернёт отзыв гостям,
      -- а разблокировка его потом уже не тронет (пункт A2-11).
      u.is_active as author_is_active,
      -- Почему отзыв скрыт: последняя из записей «скрыт/показан модератором»
      -- и «скрыт блокировкой автора» (её список hidden_review_ids). У
      -- видимого и удалённого — ничего; скрытый без записи (скрипт оператора
      -- или до журнала) — тоже ничего: панель не выдумывает причину.
      hid.action as hidden_action,
      hid.reason as hidden_reason
    FROM reviews r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN establishments e ON r.establishment_id = e.id
    -- Статистика автора одним проходом по idx_reviews_user вместо двух
    -- скоррелированных подзапросов на строку. Скрытые здесь УЧИТЫВАЮТСЯ: это
    -- характеристика автора, а не того, что видит посетитель.
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int as review_count,
        ROUND(AVG(ar.rating)::numeric, 2) as average_rating
      FROM reviews ar
      WHERE ar.user_id = r.user_id AND ar.is_deleted = FALSE ${authorVisibility}
    ) author ON TRUE
    LEFT JOIN LATERAL (
      SELECT src.action, src.reason
      FROM (
        SELECT mod.action, mod.new_data ->> 'reason' as reason, mod.created_at, mod.id
        FROM audit_log mod
        WHERE mod.entity_type = 'review' AND mod.entity_id = r.id
          AND mod.action IN ('review_hide', 'review_show')
        UNION ALL
        SELECT blk.action, blk.new_data ->> 'reason' as reason, blk.created_at, blk.id
        FROM audit_log blk
        WHERE blk.entity_type = 'user' AND blk.entity_id = r.user_id
          AND blk.action = 'user_block'
          AND blk.new_data -> 'hidden_review_ids' ? r.id::text
      ) src
      ORDER BY src.created_at DESC, src.id DESC
      LIMIT 1
    ) hid ON r.is_visible = FALSE AND r.is_deleted = FALSE
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  try {
    const result = await pool.query(query, [...values, limit, offset]);

    logger.debug('Fetched admin reviews', {
      count: result.rows.length,
      filters: { status: filters.status, rating: filters.rating },
      limit,
      offset,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching admin reviews', {
      error: error.message,
      filters,
    });
    throw error;
  }
};

/**
 * Aggregate stats over the reviews matching filters
 *
 * Заменяет прежний countAdminReviews: подпись экрана «Отзывы» показывает
 * рядом со счётчиком, сколько из них скрыто и какова средняя оценка, и все
 * три величины обязаны считаться по ОДНОЙ выборке. Отдельный запрос за каждой
 * дал бы три числа, отвечающих на разные вопросы под общим заголовком.
 *
 * `hidden` совпадает по условию с фильтром status='hidden' в buildReviewWhere:
 * иначе счётчик в шапке разошёлся бы с длиной списка под фильтром «Скрытые».
 * Средняя считается по неудалённым — так же, как её считает триггер
 * update_metrics_after_review для рейтинга заведения.
 *
 * @param {Object} filters
 * @returns {Promise<{ total: number, hidden: number, average_rating: number|null }>}
 */
export const getReviewStats = async (filters = {}) => {
  const { whereClause, values } = buildReviewWhere(filters);

  const query = `
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (
        WHERE r.is_visible = FALSE AND r.is_deleted = FALSE
      )::int as hidden,
      -- float8, а не numeric: node-pg отдаёт NUMERIC строкой.
      ROUND(
        (AVG(r.rating) FILTER (WHERE r.is_deleted = FALSE))::numeric, 2
      )::float8 as average_rating
    FROM reviews r
    ${whereClause}
  `;

  try {
    const result = await pool.query(query, values);
    const row = result.rows[0];

    return {
      total: row.total,
      hidden: row.hidden,
      average_rating: row.average_rating,
    };
  } catch (error) {
    logger.error('Error aggregating admin reviews', {
      error: error.message,
      filters,
    });
    throw error;
  }
};

/**
 * Set review visibility to an explicit value — never a toggle.
 *
 * The panel's client repeats any request answered with a 5xx (api_client.dart);
 * a toggle executed once and answered late would be undone by its own repeat
 * (critics' pack 1, point 2 — Codex C-10). The write is guarded by the value
 * the decision was read on (`fromVisible`): a concurrent change leaves the row
 * untouched and the caller re-reads.
 *
 * @param {string} reviewId - UUID of the review
 * @param {boolean} isVisible - The state the moderator asked for
 * @param {boolean} fromVisible - The state the decision was made on
 * @param {Object} [client=pool] - pg client, when the write is part of a transaction
 * @returns {Promise<Object|null>} Updated review { id, is_visible, establishment_id },
 *   or null when no row matched (not found, deleted, or changed meanwhile)
 */
export const setReviewVisibility = async (reviewId, isVisible, fromVisible, client = pool) => {
  const query = `
    UPDATE reviews
    SET
      is_visible = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    AND is_deleted = false
    AND is_visible IS NOT DISTINCT FROM $3
    RETURNING id, is_visible, establishment_id
  `;

  try {
    const result = await client.query(query, [reviewId, isVisible, fromVisible]);

    if (result.rows.length === 0) {
      return null;
    }

    logger.info('Review visibility set', {
      reviewId,
      isVisible: result.rows[0].is_visible,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error setting review visibility', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Get review by ID with establishment_id (for aggregate updates after delete)
 *
 * @param {string} reviewId
 * @returns {Promise<Object|null>}
 */
export const getReviewForAdmin = async (reviewId) => {
  const query = `
    SELECT id, establishment_id, is_deleted, is_visible
    FROM reviews
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [reviewId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching review for admin', {
      error: error.message,
      reviewId,
    });
    throw error;
  }
};

/**
 * Hide several reviews at once — those of them still visible and not deleted.
 * The rest (already hidden, deleted, unknown) are left as they are: a repeat
 * of the same batch changes nothing.
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {string[]} reviewIds
 * @returns {Promise<Array<{id: string, establishment_id: string}>>} the reviews hidden now
 */
export const hideVisibleReviews = async (client, reviewIds) => {
  const result = await client.query(
    `UPDATE reviews
     SET is_visible = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE id = ANY($1::uuid[]) AND is_visible = TRUE AND is_deleted = FALSE
     RETURNING id, establishment_id`,
    [reviewIds],
  );
  return result.rows;
};
