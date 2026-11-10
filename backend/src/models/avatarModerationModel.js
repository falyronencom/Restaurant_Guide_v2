/**
 * Whose photo other people may see — the one rule, as SQL fragments, and the
 * moderator's queue (migration 041; the Coordinator's word, 09.11.2026, thread
 * «Фото людей»).
 *
 * The rule. Other people see `users.avatar_url` only while it equals
 * `users.avatar_approved_url`, the link a moderator approved. The approval
 * belongs to one link: every write of a new photo — an upload, PUT
 * /auth/profile, a Google or Yandex sign-in, any writer added later — leaves the
 * two columns unequal by itself, and the photo is back in the queue without the
 * writer doing anything. Until a moderator approves it, other people see the
 * initial; the person sees their own photo (GET /auth/me reads avatar_url as it
 * is). One rule for every account: a panel or a service account is not in the
 * queue, and its photo is not shown either.
 *
 * Where the rule is applied: models/reviewModel.js — the author's photo of every
 * public review answer (the site, the app's old path, GET /reviews/:id, the
 * answers to the author). tests/unit/avatarExposureGuard.test.js fails when a
 * new file of the server starts naming the avatar column outside the list of
 * places that may.
 *
 * The window between the deploy and migration 041: the approved link is read
 * through to_jsonb(users), where a missing column reads NULL, so nobody's photo
 * reaches other people and no query fails (the reading of 035 and 037). The
 * panel's actions ask avatarModerationReady() first and refuse with a text.
 *
 * Every fragment takes a table alias from the code, never input.
 */

import pool from '../config/database.js';
import { serviceAccountFlagSql } from '../config/serviceAccounts.js';

const ALIAS = /^[a-z_][a-z0-9_]*$/;

const checkedAlias = (alias) => {
  if (!ALIAS.test(alias)) throw new Error(`avatar SQL: not a table alias: ${alias}`);
  return alias;
};

/**
 * The link a moderator approved, NULL without one — and without the column.
 *
 * @param {string} alias - alias of the users table in the query
 * @returns {string} SQL expression
 */
export const approvedAvatarSql = (alias) => `(to_jsonb(${checkedAlias(alias)}) ->> 'avatar_approved_url')`;

/**
 * The photo other people may see: the person's link while a moderator has
 * approved exactly it, NULL otherwise.
 *
 * @param {string} alias - alias of the users table in the query
 * @returns {string} SQL expression
 */
export const publicAvatarSql = (alias) => {
  const u = checkedAlias(alias);
  return `(CASE WHEN ${u}.avatar_url IS NOT NULL AND ${u}.avatar_url = ${approvedAvatarSql(u)}
                THEN ${u}.avatar_url END)`;
};

/**
 * Where the photo stands, as the panel shows it: 'none' — no photo; 'approved' —
 * other people see it; 'pending' — only the person does.
 *
 * @param {string} alias - alias of the users table in the query
 * @returns {string} SQL expression
 */
export const avatarStateSql = (alias) => {
  const u = checkedAlias(alias);
  return `(CASE WHEN ${u}.avatar_url IS NULL THEN 'none'
               WHEN ${u}.avatar_url = ${approvedAvatarSql(u)} THEN 'approved'
               ELSE 'pending' END)`;
};

/**
 * The queue: a photo waiting for a moderator, of an account people meet — a
 * switched-on person or partner, not a service account. A panel account, a
 * service account, a blocked one: not in the queue, and its photo stays hidden
 * from other people all the same (publicAvatarSql).
 *
 * @param {string} alias - alias of the users table in the query
 * @returns {string} SQL condition
 */
export const avatarQueueConditionSql = (alias) => {
  const u = checkedAlias(alias);
  return `(${u}.avatar_url IS NOT NULL
           AND ${u}.avatar_url IS DISTINCT FROM ${approvedAvatarSql(u)}
           AND ${u}.is_active = TRUE
           AND ${u}.role IN ('user', 'partner')
           AND NOT ${serviceAccountFlagSql(u)})`;
};

/**
 * Whether migration 041 is applied: the approved-link column and the file
 * deletion table. Asked before the panel's actions, which write both.
 *
 * @param {Object} [db=pool] - pool or a connected client
 * @returns {Promise<boolean>}
 */
export const avatarModerationReady = async (db = pool) => {
  const result = await db.query(
    `SELECT EXISTS (
              SELECT 1 FROM pg_attribute
               WHERE attrelid = 'public.users'::regclass
                 AND attname = 'avatar_approved_url' AND NOT attisdropped
            )
        AND to_regclass('public.avatar_file_deletions') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
};

/**
 * How many photos wait for a moderator — the rail's badge.
 *
 * @returns {Promise<number>}
 */
export const countPendingAvatars = async () => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS pending FROM users u WHERE ${avatarQueueConditionSql('u')}`,
  );
  return result.rows[0].pending;
};
