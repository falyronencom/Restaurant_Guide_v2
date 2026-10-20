/**
 * Admin User Model — the people of the platform as the panel's «Пользователи»
 * screen reads them (tester walkthrough 17.10, p. 8: the moderator finds a
 * person by e-mail, phone or name and blocks them).
 *
 * Reads only. The block, the unblock and the name reset write inside one
 * transaction each and live in services/adminUserService.js.
 *
 * is_service_account (migration 037) is read through to_jsonb(users), where a
 * missing column reads false (config/serviceAccounts.js).
 */

import pool from '../config/database.js';
import { serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { CATALOGUE_TRACK_STATUSES } from '../constants/establishmentVocab.js';
import { escapeLike } from './adminReviewModel.js';

/**
 * The statuses as SQL literals — a fixed list from the code, never input: the
 * column fragments below take no parameters.
 */
const CATALOGUE_TRACK_SQL = CATALOGUE_TRACK_STATUSES.map((status) => `'${status}'`).join(', ');
import logger from '../utils/logger.js';

/**
 * Whether the holder deleted the account: its journal entry
 * user_delete_account exists — the mark accountDeletionService reads
 * (wasAccountDeleted). The literal, not the service's constant: a model does
 * not import a service.
 */
const DELETED_SQL = `EXISTS (
    SELECT 1 FROM audit_log del
    WHERE del.entity_type = 'user' AND del.entity_id = u.id AND del.action = 'user_delete_account'
  )`;

/**
 * A LIKE pattern that matches the text literally (adminReviewModel.escapeLike).
 */
const likeText = (value) => `%${escapeLike(value)}%`;

/** The role filter of the list: the words the panel sends. */
const ROLE_CONDITIONS = Object.freeze({
  user: "u.role = 'user'",
  partner: "u.role = 'partner'",
  panel: "u.role IN ('admin', 'viewer')",
});

/**
 * The columns of one person. A viewer — the read-only panel role shown to
 * people outside the project — gets no name and no contact (the fragments are
 * fixed SQL chosen by a boolean), and review counts over VISIBLE reviews only:
 * counting hidden ones in would let the difference name how many of a
 * person's reviews were taken out of view (the reasoning of
 * adminReviewModel.getAdminReviews).
 *
 * @param {boolean} viewer
 * @returns {string}
 */
const userColumns = (viewer) => `
  u.id,
  ${viewer ? 'NULL::text' : 'u.name'} AS name,
  ${viewer ? 'NULL::text' : 'u.email'} AS email,
  ${viewer ? 'NULL::text' : 'u.phone'} AS phone,
  u.role,
  u.auth_method,
  u.is_active,
  -- A deleted account is switched off too, but it is not «blocked»: the
  -- panel shows it as deleted, without buttons the server always refuses
  -- (walkthrough 20.10, A2-05).
  ${DELETED_SQL} AS is_deleted,
  ${serviceAccountFlagSql('u')} AS is_service_account,
  -- AT TIME ZONE 'UTC': the column is timestamp WITHOUT time zone and
  -- node-pg would otherwise read it in the process's local zone.
  u.created_at AT TIME ZONE 'UTC' AS created_at,
  counts.review_count,
  ${viewer ? 'NULL::int' : 'counts.hidden_review_count'} AS hidden_review_count,
  (SELECT COUNT(*)::int FROM establishments e WHERE e.partner_id = u.id) AS establishment_count,
  -- Cards in the catalogue or on moderation: these, not drafts, keep the
  -- block button from a partner (adminUserService.lockTarget).
  (SELECT COUNT(*)::int FROM establishments e
    WHERE e.partner_id = u.id AND e.status IN (${CATALOGUE_TRACK_SQL})) AS live_establishment_count`;

/**
 * Review counts of the person: every review not deleted, and of them the
 * hidden ones. For a viewer the first counts visible reviews only.
 *
 * @param {boolean} viewer
 * @returns {string}
 */
const countsJoin = (viewer) => `
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE ${viewer ? 'r.is_visible = TRUE' : 'TRUE'})::int AS review_count,
      COUNT(*) FILTER (WHERE r.is_visible = FALSE)::int AS hidden_review_count
    FROM reviews r
    WHERE r.user_id = u.id AND r.is_deleted = FALSE
  ) counts ON TRUE`;

/**
 * WHERE of the list. The search matches the e-mail, the name, or — when it
 * holds at least three digits — the digits of the phone, whatever the
 * spacing either side was written with («+375 29 123» finds +375291234567).
 *
 * «Заблокированные» are the accounts switched off and not deleted: a deleted
 * account is its own filter (A2-05).
 *
 * @param {Object} filters
 * @param {string} [filters.search]
 * @param {'active'|'blocked'|'deleted'} [filters.status]
 * @param {'user'|'partner'|'panel'} [filters.role]
 * @returns {{ whereClause: string, values: Array, paramIndex: number }}
 */
const buildUserWhere = ({ search, status, role } = {}) => {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (status === 'active') conditions.push('u.is_active = TRUE');
  if (status === 'blocked') conditions.push(`u.is_active = FALSE AND NOT ${DELETED_SQL}`);
  if (status === 'deleted') conditions.push(DELETED_SQL);
  if (ROLE_CONDITIONS[role]) conditions.push(ROLE_CONDITIONS[role]);

  const text = typeof search === 'string' ? search.trim() : '';
  if (text) {
    // «%» and «_» match themselves (walkthrough 20.10, A2-20).
    const alternatives = [
      `u.email ILIKE $${paramIndex} ESCAPE '\\'`,
      `u.name ILIKE $${paramIndex} ESCAPE '\\'`,
    ];
    values.push(likeText(text));
    paramIndex += 1;

    const digits = text.replace(/\D/g, '');
    if (digits.length >= 3) {
      alternatives.push(`regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $${paramIndex}`);
      values.push(`%${digits}%`);
      paramIndex += 1;
    }
    conditions.push(`(${alternatives.join(' OR ')})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, values, paramIndex };
};

/**
 * A page of people, newest first.
 *
 * @param {Object} filters - { search, status, viewer }
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>}
 */
export const getUsers = async (filters = {}, limit = 20, offset = 0) => {
  const viewer = filters.viewer === true;
  const { whereClause, values, paramIndex } = buildUserWhere(filters);

  const query = `
    SELECT ${userColumns(viewer)}
    FROM users u
    ${countsJoin(viewer)}
    ${whereClause}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  try {
    const result = await pool.query(query, [...values, limit, offset]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching admin users', { error: error.message });
    throw error;
  }
};

/**
 * How many people match the filters (for pagination).
 *
 * @param {Object} filters - { search, status, role }
 * @returns {Promise<number>}
 */
export const countUsers = async (filters = {}) => {
  const { whereClause, values } = buildUserWhere(filters);
  try {
    const result = await pool.query(`SELECT COUNT(*)::int AS total FROM users u ${whereClause}`, values);
    return result.rows[0].total;
  } catch (error) {
    logger.error('Error counting admin users', { error: error.message });
    throw error;
  }
};

/** How many blocks and unblocks the card lists. */
export const BLOCK_HISTORY_LIMIT = 20;

/** How many of a partner's cards the person's card names. */
export const PARTNER_CARDS_LIMIT = 10;

/**
 * One person with the latest block or unblock from the journal: who did it,
 * when and why. The operator's script (scripts/set-user-active.js) writes the
 * same entries since 2026-10-18, with no admin (user_id NULL); a blocked
 * account without any entry was switched off by it before that.
 *
 * block_history — the latest blocks and unblocks, newest first: the reason of
 * a block stays visible after the unblock (walkthrough 20.10, A2-15, Chrome
 * pass p. 35). by_operator marks an entry of the operator's script. The
 * counts of hidden and shown reviews come as numbers, never the ids.
 * establishments — a partner's cards by name and status (Chrome pass p. 35);
 * not for a viewer, who sees no person's name either.
 *
 * @param {string} userId
 * @param {Object} [options]
 * @param {boolean} [options.viewer=false]
 * @returns {Promise<Object|null>}
 */
export const getUserById = async (userId, { viewer = false } = {}) => {
  const query = `
    SELECT ${userColumns(viewer)},
      (
        SELECT json_build_object(
          'action', al.action,
          -- The reason is the moderator's free text about a person and may
          -- name them: not for a viewer (Phase 3.5 lens review).
          'reason', ${viewer ? 'NULL::text' : "al.new_data ->> 'reason'"},
          'created_at', al.created_at AT TIME ZONE 'UTC',
          'admin_name', ${viewer ? 'NULL::text' : 'actor.name'}
        )
        FROM audit_log al
        LEFT JOIN users actor ON actor.id = al.user_id
        WHERE al.entity_type = 'user'
          AND al.entity_id = u.id
          AND al.action IN ('user_block', 'user_unblock')
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT 1
      ) AS last_block_action,
      (
        SELECT COALESCE(json_agg(entry ORDER BY entry.sort_at DESC, entry.id DESC), '[]'::json)
        FROM (
          SELECT
            al.id,
            al.created_at AS sort_at,
            al.action,
            ${viewer ? 'NULL::text' : "al.new_data ->> 'reason'"} AS reason,
            al.created_at AT TIME ZONE 'UTC' AS created_at,
            ${viewer ? 'NULL::text' : 'actor.name'} AS admin_name,
            (al.user_id IS NULL AND al.new_data ? 'actor') AS by_operator,
            CASE WHEN jsonb_typeof(al.new_data -> 'hidden_review_ids') = 'array'
              THEN jsonb_array_length(al.new_data -> 'hidden_review_ids') END AS hidden_reviews,
            CASE WHEN jsonb_typeof(al.new_data -> 'restored_review_ids') = 'array'
              THEN jsonb_array_length(al.new_data -> 'restored_review_ids') END AS restored_reviews
          FROM audit_log al
          LEFT JOIN users actor ON actor.id = al.user_id
          WHERE al.entity_type = 'user'
            AND al.entity_id = u.id
            AND al.action IN ('user_block', 'user_unblock')
          ORDER BY al.created_at DESC, al.id DESC
          LIMIT ${BLOCK_HISTORY_LIMIT}
        ) entry
      ) AS block_history,
      ${viewer ? 'NULL::json' : `(
        SELECT COALESCE(json_agg(card ORDER BY card.name, card.id), '[]'::json)
        FROM (
          SELECT e.id, e.name, e.city, e.status
          FROM establishments e
          WHERE e.partner_id = u.id
          ORDER BY e.name, e.id
          LIMIT ${PARTNER_CARDS_LIMIT}
        ) card
      )`} AS establishments
    FROM users u
    ${countsJoin(viewer)}
    WHERE u.id = $1
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching admin user', { error: error.message, userId });
    throw error;
  }
};
