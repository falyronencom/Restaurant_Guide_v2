/**
 * Audit Log Model
 *
 * Database access methods for the audit_log table.
 * Records administrative actions for accountability and transparency.
 *
 * Table schema (from database_schema_v2.0.sql):
 *   id UUID, user_id UUID, action VARCHAR(100), entity_type VARCHAR(50),
 *   entity_id UUID, old_data JSONB, new_data JSONB, ip_address INET,
 *   user_agent TEXT, created_at TIMESTAMP
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Insert an audit log entry
 *
 * Non-critical: failures are logged but do not propagate.
 * This ensures audit logging never blocks the primary operation.
 *
 * @param {Object} data
 * @param {string} data.user_id - UUID of the admin performing the action
 * @param {string} data.action - Action type (e.g. 'moderate_approve', 'moderate_reject')
 * @param {string} data.entity_type - Entity type (e.g. 'establishment')
 * @param {string} data.entity_id - UUID of the affected entity
 * @param {Object} data.old_data - State before action (optional)
 * @param {Object} data.new_data - State after action / action details (optional)
 * @param {string} data.ip_address - Request IP address (optional)
 * @param {string} data.user_agent - Request user agent (optional)
 * @returns {Promise<Object|null>} Created record or null on failure
 */
export const createAuditLog = async (data) => {
  const {
    user_id,
    action,
    entity_type,
    entity_id,
    old_data = null,
    new_data = null,
    ip_address = null,
    user_agent = null,
  } = data;

  // Позиция меню получает в old_data снимок своего названия и заведения на
  // момент действия (проход по панели модератора, 20.10, пункт A3-03): журнал
  // читает человек, а «Позиция меню 7f5534fa» ему ничего не говорит, и после
  // повторного распознавания строки с этим id уже нет — присоединить её имя
  // при чтении журнала будет не к чему. Снимок берётся здесь, одним
  // оператором с самой записью, — поэтому его получают все писатели позиций
  // меню, и копии одного клика тоже, без правки каждого из них. Ключи,
  // переданные писателем, сильнее снимка.
  const query = `
    INSERT INTO audit_log (
      user_id,
      action,
      entity_type,
      entity_id,
      old_data,
      new_data,
      ip_address,
      user_agent
    )
    SELECT $1::uuid, $2::text, $3::text, $4::uuid,
      CASE
        WHEN $3::text = 'menu_item' THEN NULLIF(
          COALESCE((
            SELECT jsonb_strip_nulls(jsonb_build_object(
              'item_name', mi.item_name,
              'establishment_name', e.name,
              'establishment_city', e.city
            ))
            FROM menu_items mi
            LEFT JOIN establishments e ON e.id = mi.establishment_id
            WHERE mi.id = $4::uuid
          ), '{}'::jsonb) || COALESCE($5::jsonb, '{}'::jsonb),
          '{}'::jsonb
        )
        ELSE $5::jsonb
      END,
      $6::jsonb, $7::inet, $8::text
    RETURNING id, created_at
  `;

  const values = [
    user_id,
    action,
    entity_type,
    entity_id,
    old_data ? JSON.stringify(old_data) : null,
    new_data ? JSON.stringify(new_data) : null,
    ip_address,
    user_agent,
  ];

  try {
    const result = await pool.query(query, values);

    logger.info('Audit log entry created', {
      auditId: result.rows[0].id,
      userId: user_id,
      action,
      entityType: entity_type,
      entityId: entity_id,
    });

    return result.rows[0];
  } catch (error) {
    // Non-critical: log error but do not propagate
    logger.error('Failed to create audit log entry', {
      error: error.message,
      userId: user_id,
      action,
      entityType: entity_type,
      entityId: entity_id,
    });
    return null;
  }
};

/**
 * Insert an audit log entry inside the caller's transaction — and fail with
 * it. For an entry another action reads back: the unblock of a person
 * (adminUserService.unblockUser) leaves hidden a review a moderator hid or
 * showed one by one after the block, and learns that from this entry. Written
 * «softly» (createAuditLog), a lost entry let the unblock show again a review
 * the moderator had hidden (tester walkthrough 17.10, P8 report, finding 4).
 *
 * created_at is clock_timestamp() — the moment of the write, after the row
 * lock the action waited for — not CURRENT_TIMESTAMP, the start of the
 * transaction; the same rule as the block's own entry.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {Object} data - same fields as createAuditLog
 * @returns {Promise<{id: string, created_at: Date}>}
 */
export const writeAuditLogInTransaction = async (client, data) => {
  const {
    user_id,
    action,
    entity_type,
    entity_id,
    old_data = null,
    new_data = null,
    ip_address = null,
    user_agent = null,
  } = data;

  const result = await client.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())
     RETURNING id, created_at`,
    [
      user_id,
      action,
      entity_type,
      entity_id,
      old_data ? JSON.stringify(old_data) : null,
      new_data ? JSON.stringify(new_data) : null,
      ip_address,
      user_agent,
    ],
  );
  return result.rows[0];
};

/**
 * Latest audit entry of one action on one entity, with the actor's name.
 *
 * Used for "who suspended this establishment": moderation_notes carries the
 * reason and the time but no author, and the audit log is the only carrier
 * of authorship. Reading it back keeps a single source of truth.
 *
 * @param {Object} params
 * @param {string} params.entityType - e.g. 'establishment'
 * @param {string} params.entityId - UUID of the entity
 * @param {string} params.action - e.g. 'suspend'
 * @returns {Promise<Object|null>} { user_id, admin_name, admin_email, created_at } or null
 */
export const getLatestEntityAction = async ({ entityType, entityId, action }) => {
  const query = `
    SELECT
      al.user_id,
      u.name AS admin_name,
      u.email AS admin_email,
      -- AT TIME ZONE 'UTC': the column is timestamp WITHOUT time zone and
      -- node-pg would otherwise read it in the process's local zone.
      al.created_at AT TIME ZONE 'UTC' AS created_at
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.entity_type = $1
      AND al.entity_id = $2
      AND al.action = $3
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [entityType, entityId, action]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching latest entity action from audit log', {
      error: error.message,
      entityType,
      entityId,
      action,
    });
    throw error;
  }
};

/**
 * Get rejection history from audit log
 * Joins with establishments to show current state
 *
 * @param {number} limit - Max items per page
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of rejection event objects
 */
export const getRejectionHistory = async (limit = 20, offset = 0) => {
  // Use DISTINCT ON to show only the latest rejection per establishment.
  // Multiple audit_log entries exist if an establishment is rejected, resubmitted, rejected again.
  const query = `
    SELECT DISTINCT ON (e.id)
      al.id as audit_id,
      al.created_at as rejection_date,
      al.new_data,
      e.id as establishment_id,
      e.name,
      e.city,
      e.categories,
      e.cuisines,
      e.status as current_status,
      e.moderation_notes,
      (
        SELECT json_build_object(
          'url', em.url,
          'thumbnail_url', em.thumbnail_url
        )
        FROM establishment_media em
        WHERE em.establishment_id = e.id
        ORDER BY em.is_primary DESC, (CASE WHEN em.type = 'interior' THEN 0 ELSE 1 END), em.position ASC
        LIMIT 1
      ) as primary_photo
    FROM audit_log al
    JOIN establishments e ON al.entity_id::text = e.id::text
    WHERE al.action = 'moderate_reject'
      AND al.entity_type = 'establishment'
      AND e.status = 'rejected'
    ORDER BY e.id, al.created_at DESC
  `;

  // Wrap with subquery for proper pagination + sorting by rejection_date
  const paginatedQuery = `
    SELECT * FROM (${query}) AS latest_rejections
    ORDER BY rejection_date DESC
    LIMIT $1 OFFSET $2
  `;

  try {
    const result = await pool.query(paginatedQuery, [limit, offset]);

    logger.debug('Fetched rejection history', {
      count: result.rows.length,
      limit,
      offset,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching rejection history', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Count total rejection events (for pagination)
 *
 * @returns {Promise<number>} Total count
 */
export const countRejections = async () => {
  // Count unique establishments currently in 'rejected' status (not audit_log entries)
  const query = `
    SELECT COUNT(DISTINCT e.id) as total
    FROM audit_log al
    JOIN establishments e ON al.entity_id::text = e.id::text
    WHERE al.action = 'moderate_reject'
      AND al.entity_type = 'establishment'
      AND e.status = 'rejected'
  `;

  try {
    const result = await pool.query(query);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting rejections', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Build dynamic WHERE clause and values array for audit log queries
 *
 * @param {Object} filters
 * @returns {{ whereClause: string, values: Array }}
 */
const buildAuditLogWhere = (filters) => {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (filters.action) {
    conditions.push(`al.action = $${paramIndex++}`);
    values.push(filters.action);
  }

  if (filters.entity_type) {
    conditions.push(`al.entity_type = $${paramIndex++}`);
    values.push(filters.entity_type);
  }

  if (filters.user_id) {
    conditions.push(`al.user_id = $${paramIndex++}`);
    values.push(filters.user_id);
  }

  if (filters.from) {
    conditions.push(`al.created_at >= $${paramIndex++}`);
    values.push(filters.from);
  }

  if (filters.to) {
    conditions.push(`al.created_at <= $${paramIndex++}`);
    values.push(filters.to);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return { whereClause, values, paramIndex };
};

/**
 * Get paginated audit log entries with admin info and human-readable summary
 *
 * @param {Object} filters
 * @param {string} [filters.action] - Filter by action type
 * @param {string} [filters.entity_type] - Filter by entity type
 * @param {string} [filters.user_id] - Filter by admin who performed action
 * @param {string} [filters.from] - Date range start (ISO string)
 * @param {string} [filters.to] - Date range end (ISO string)
 * @param {string} [filters.sort] - 'newest' (default) or 'oldest'
 * @param {boolean} [filters.include_metadata] - Include ip_address and user_agent
 * @param {boolean} [filters.viewer] - Caller is the read-only panel role: the
 *   actor is named by role only (admin_name / admin_email null), the review
 *   author is not named, and the opening of a review's text is given only
 *   while the review is visible (pack 2, point 2; cloud critic 2A B-2, 2B B1)
 * @param {number} limit - Max items per page
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} Array of audit log entry objects
 */
export const getAuditLogEntries = async (filters = {}, limit = 20, offset = 0) => {
  const { whereClause, values, paramIndex } = buildAuditLogWhere(filters);

  const sortOrder = filters.sort === 'oldest' ? 'ASC' : 'DESC';

  const metadataColumns = filters.include_metadata
    ? ', al.ip_address, al.user_agent'
    : '';

  // Columns about people. A viewer — the read-only role shown to people
  // outside the project — learns what happened and when, and who acted only
  // by role: a moderator's e-mail is a phishing target, and a partner who
  // deleted a card is written into the same «admin» columns. The fragments are
  // fixed SQL chosen by a boolean, never built from input.
  const viewer = filters.viewer === true;
  const actorColumns = viewer
    ? 'NULL::text as admin_name, NULL::text as admin_email'
    : 'u.name as admin_name, u.email as admin_email';
  const reviewerName = viewer ? 'NULL::text' : 'reviewer.name';
  // The person an action on an account was about (block, name reset): named to
  // an admin, not to a viewer — the projection withholds user_name as well.
  const targetName = viewer ? 'NULL::text' : 'target.name';
  // The opening of a review text: to a viewer only while the review is
  // visible now — the log keeps entries of hiding and deleting, and the text
  // they point at is exactly what was taken out of public view.
  const textSnippet = viewer
    ? 'CASE WHEN r.is_visible = TRUE AND r.is_deleted = FALSE THEN LEFT(r.text, 120) END'
    : 'LEFT(r.text, 120)';

  // What a block, an unblock or a name reset from the panel carried — the
  // person's old name, the moderator's reason (free text about a person), the
  // reviews the block hid and the unblock showed — stays with an admin. A
  // viewer learns that a person was blocked and when, not which reviews were
  // theirs: the ids would tie a hidden review to the person again (Phase 3.5
  // review: regular and lens). Other entries are as they were: their personal
  // keys go through the viewer projection. Fixed SQL chosen by a boolean.
  //
  // Hiding, showing and deleting a review keep their entry for a viewer but
  // lose `reason`: the moderator's free text about the review, which may name
  // its author. The «Reviews» screen withholds the same reason from a viewer
  // (adminReviewService.getReviews, PR #118); the journal handed it over
  // (walkthrough of the moderator panel, wave 3, Phase 3.5 lens review).
  // `batch_id` — the panel's own mark of one «Скрыть выбранные» — stays with
  // an admin too; a viewer keeps `batch_size` (walkthrough, after wave 3).
  const changeColumns = viewer
    ? `CASE WHEN al.action IN ('user_block', 'user_unblock', 'user_reset_name')
          THEN NULL ELSE al.old_data END as old_data,
      CASE WHEN al.action IN ('user_block', 'user_unblock', 'user_reset_name')
          THEN NULL
        WHEN al.action IN ('review_hide', 'review_show', 'review_delete')
          THEN al.new_data - 'reason' - 'batch_id'
        ELSE al.new_data END as new_data`
    : 'al.old_data, al.new_data';

  const query = `
    SELECT
      al.id,
      al.action,
      al.entity_type,
      al.entity_id,
      ${changeColumns},
      -- AT TIME ZONE 'UTC' обязателен: колонка — timestamp WITHOUT time zone,
      -- и node-pg читает такую метку как местное время своего процесса. В
      -- проде (TZ=UTC) совпадает, у разработчика уезжает на его часовой пояс.
      -- Сортировка и границы from/to ходят по сырой колонке и не затронуты.
      al.created_at AT TIME ZONE 'UTC' as created_at,
      ${actorColumns},
      -- Роль исполнителя: просмотрщику — вместо имени, администратору — рядом.
      u.role as actor_role,
      -- Кто действовал, когда автора-человека у записи нет (user_id пуст):
      -- скрипт оператора называет себя в new_data.actor или в user_agent
      -- («operator_script:…», «scripts/…»), остальное — сама система (захват
      -- учётной записи, удаление вместе с ней). Без этого поля панель писала
      -- «не указан», будто журнал потерял автора (проход по панели, A3-06).
      CASE
        WHEN al.user_id IS NOT NULL THEN 'person'
        WHEN COALESCE(al.new_data->>'actor', '') LIKE 'operator_script:%'
          OR COALESCE(al.user_agent, '') LIKE 'operator_script:%'
          OR COALESCE(al.user_agent, '') LIKE 'scripts/%'
          THEN 'operator_script'
        ELSE 'system'
      END as actor_kind,
      CASE
        WHEN al.action = 'moderate_approve' AND al.entity_type = 'establishment' THEN 'Одобрено заведение'
        WHEN al.action = 'moderate_reject' AND al.entity_type = 'establishment' THEN 'Отклонено заведение'
        WHEN al.action = 'suspend' AND al.entity_type = 'establishment' THEN 'Приостановлено заведение'
        WHEN al.action = 'unsuspend' AND al.entity_type = 'establishment' THEN 'Возобновлено заведение'
        WHEN al.action = 'partner_pause' AND al.entity_type = 'establishment' THEN 'Партнёр приостановил заведение'
        WHEN al.action = 'partner_resume' AND al.entity_type = 'establishment' THEN 'Партнёр возобновил заведение'
        WHEN al.action = 'review_hide' AND al.entity_type = 'review' THEN 'Скрыт отзыв'
        WHEN al.action = 'review_show' AND al.entity_type = 'review' THEN 'Показан отзыв'
        WHEN al.action = 'review_delete' AND al.entity_type = 'review' THEN 'Удалён отзыв'
        WHEN al.action = 'admin_update_coordinates' AND al.entity_type = 'establishment' THEN 'Координаты обновлены'
        WHEN al.action = 'claim_establishment' AND al.entity_type = 'establishment' THEN 'Заведение передано партнёру'
        WHEN al.action = 'partner_delete_establishment' AND al.entity_type = 'establishment' AND al.user_id IS NULL THEN 'Заведение удалено вместе с учётной записью по заявке в поддержку'
        WHEN al.action = 'partner_delete_establishment' AND al.entity_type = 'establishment' THEN 'Заведение удалено партнёром'
        WHEN al.action = 'upgrade_user_to_partner' AND al.entity_type = 'user' THEN 'Пользователь повышен до партнёра'
        WHEN al.action = 'user_block' AND al.entity_type = 'user' THEN 'Пользователь заблокирован'
        WHEN al.action = 'user_unblock' AND al.entity_type = 'user' THEN 'Пользователь разблокирован'
        WHEN al.action = 'user_reset_name' AND al.entity_type = 'user' THEN 'Имя пользователя сброшено'
        WHEN al.action = 'user_delete_account' AND al.entity_type = 'user' AND al.user_id IS NULL THEN 'Учётная запись удалена по заявке в поддержку'
        WHEN al.action = 'user_delete_account' AND al.entity_type = 'user' THEN 'Пользователь удалил учётную запись'
        WHEN al.action = 'change_email' AND al.entity_type = 'user' THEN 'Адрес e-mail учётной записи изменён'
        WHEN al.action = 'mark_service_account' AND al.entity_type = 'user' THEN 'Учётная запись отмечена служебной'
        WHEN al.action = 'operator_create_admin' AND al.entity_type = 'user' THEN 'Создан администратор'
        WHEN al.action = 'operator_reset_admin' AND al.entity_type = 'user' THEN 'Администратору задан пароль'
        WHEN al.action = 'operator_promote_admin' AND al.entity_type = 'user' THEN 'Учётная запись повышена до администратора'
        WHEN al.action = 'admin_update_slug' AND al.entity_type = 'establishment' THEN 'Адрес страницы изменён'
        WHEN al.action = 'hide_menu_item' AND al.entity_type = 'menu_item' THEN 'Скрыта позиция меню'
        WHEN al.action = 'unhide_menu_item' AND al.entity_type = 'menu_item' THEN 'Показана позиция меню'
        WHEN al.action = 'dismiss_sanity_flag' AND al.entity_type = 'menu_item' THEN 'Снят флаг с позиции меню'
        -- Фолбэк намеренно выглядит машинным: он и есть симптом того, что в
        -- журнал начали писать действие, которого нет в этой карте. Сторож
        -- ловит такую подпись admin-audit-log-summaries.test.js: он сверяет
        -- карту с полным списком действий, которые сервисы реально пишут,
        -- поэтому дрейф обнаружится на гейте, а не на экране модератора.
        -- Обратных кавычек здесь быть не может: запрос лежит в JS-шаблоне,
        -- и любая из них оборвёт строку прямо посреди SQL.
        ELSE al.action || ' (' || al.entity_type || ')'
      END as summary,
      CASE
        -- Удалённое заведение join уже не найдёт: название и город берутся из
        -- old_data, куда их кладёт само удаление (partner_delete_establishment).
        WHEN al.entity_type = 'establishment' THEN
          json_build_object(
            'name', COALESCE(e_direct.name, al.old_data->>'name'),
            'city', COALESCE(e_direct.city, al.old_data->>'city')
          )
        WHEN al.entity_type = 'review' THEN
          json_build_object(
            'reviewer_name', ${reviewerName},
            'rating', r.rating,
            'text_snippet', ${textSnippet},
            'establishment_name', e_review.name,
            'establishment_city', e_review.city
          )
        WHEN al.entity_type = 'user' THEN
          json_build_object('user_name', ${targetName})
        -- Позиция меню: название и заведение из снимка на момент действия
        -- (createAuditLog кладёт его в old_data), иначе — из нынешней строки:
        -- так имя есть и у записей, сделанных до снимка, пока позиция жива.
        WHEN al.entity_type = 'menu_item' THEN
          json_build_object(
            'item_name', COALESCE(al.old_data->>'item_name', mi.item_name),
            'establishment_name', COALESCE(al.old_data->>'establishment_name', e_menu.name),
            'establishment_city', COALESCE(al.old_data->>'establishment_city', e_menu.city)
          )
        ELSE NULL
      END as entity_context
      ${metadataColumns}
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    LEFT JOIN establishments e_direct
      ON al.entity_type = 'establishment' AND al.entity_id = e_direct.id
    LEFT JOIN reviews r
      ON al.entity_type = 'review' AND al.entity_id = r.id
    LEFT JOIN users reviewer
      ON al.entity_type = 'review' AND r.user_id = reviewer.id
    LEFT JOIN establishments e_review
      ON al.entity_type = 'review' AND r.establishment_id = e_review.id
    LEFT JOIN users target
      ON al.entity_type = 'user' AND al.entity_id = target.id
    LEFT JOIN menu_items mi
      ON al.entity_type = 'menu_item' AND al.entity_id = mi.id
    LEFT JOIN establishments e_menu
      ON al.entity_type = 'menu_item' AND mi.establishment_id = e_menu.id
    ${whereClause}
    ORDER BY al.created_at ${sortOrder}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  try {
    const result = await pool.query(query, [...values, limit, offset]);

    logger.debug('Fetched audit log entries', {
      count: result.rows.length,
      filters: { action: filters.action, entity_type: filters.entity_type },
      limit,
      offset,
    });

    return result.rows;
  } catch (error) {
    logger.error('Error fetching audit log entries', {
      error: error.message,
      filters,
    });
    throw error;
  }
};

/**
 * Count audit log entries matching filters (for pagination)
 *
 * @param {Object} filters - Same filters as getAuditLogEntries
 * @returns {Promise<number>} Total count
 */
export const countAuditLogEntries = async (filters = {}) => {
  const { whereClause, values } = buildAuditLogWhere(filters);

  const query = `
    SELECT COUNT(*) as total
    FROM audit_log al
    ${whereClause}
  `;

  try {
    const result = await pool.query(query, values);
    return parseInt(result.rows[0].total, 10);
  } catch (error) {
    logger.error('Error counting audit log entries', {
      error: error.message,
      filters,
    });
    throw error;
  }
};
