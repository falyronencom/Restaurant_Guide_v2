/**
 * Admin User Service — the moderator stops a person from the panel
 * (tester walkthrough 17.10, p. 8; Coordinator decision В9: now, not by the
 * store launch).
 *
 * Three actions, each with a reason, each written to the journal (audit_log,
 * where review moderation is written):
 *
 *   - block — the existing switch-off of an account (users.is_active = false):
 *     login and token refresh are refused, every session, push device and
 *     unused reset link ends. And every VISIBLE review of the person is hidden.
 *   - unblock — switches the account on and shows again only the reviews the
 *     block hid, not those a moderator hid one by one.
 *   - reset name — the name becomes «Пользователь», on past reviews too: a
 *     review shows the author's name from the profile.
 *
 * Which reviews the block hid is written into the journal entry of the block
 * itself (new_data.hidden_review_ids), in the same transaction as the hiding —
 * no new column. The unblock reads the latest block entry and shows those of
 * the reviews that are still hidden and not deleted, and that no moderator
 * has shown or hidden one by one since the block: such a review is the
 * moderator's decision now, not the block's.
 *
 * Who cannot be blocked by this button: panel accounts (admin, viewer) and
 * the service account — their access is the operator's
 * (config/serviceAccounts.js) — and a partner whose card is in the catalogue
 * or on moderation (CATALOGUE_TRACK_STATUSES: active, pending, suspended):
 * blocking them decides the fate of the cards, a separate product decision. A
 * draft, rejected or archived card does not protect: a user makes a draft in
 * one request and becomes a partner by it (establishmentService, «partner
 * registration»), so counting drafts would let anyone make themselves
 * unblockable (Phase 3.5 lens review). The moderator who wants to block the
 * author of a junk card on moderation rejects the card first. Oneself — never.
 * Panel and service accounts cannot be unblocked or renamed here either. Nor
 * can an account its holder deleted (accountDeletionService): the shell left
 * of it is switched off and named «Гость» by the deletion, and switching it on
 * or renaming it would undo what the person asked for.
 *
 * The journal time of an action is the moment it holds the account row
 * (clock_timestamp() under the lock), not the start of its transaction: a
 * block that began first but waited for an unblock must come after it in the
 * journal, or «the latest of block and unblock» names the wrong one.
 *
 * Every action is idempotent: the panel's client repeats a request answered
 * with a 5xx, and the first attempt may have been applied. A repeat that finds
 * the account already in the asked state changes and writes nothing.
 *
 * The texts are Russian: the panel shows the server's message to the
 * moderator as it is.
 */

import { getClient } from '../config/database.js';
import { isOperatorManaged, serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { isPanelRole } from '../config/panelRoles.js';
import { AppError } from '../middleware/errorHandler.js';
import * as AdminUserModel from '../models/adminUserModel.js';
import * as ReviewModel from '../models/reviewModel.js';
import { endAllAccess } from './authService.js';
import { invalidateAccountStatus } from './accountStatus.js';
import { wasAccountDeleted } from './accountDeletionService.js';
import { PROVIDER_NAME_FALLBACK } from '../utils/userName.js';
import { CATALOGUE_TRACK_STATUSES } from '../constants/establishmentVocab.js';
import logger from '../utils/logger.js';

/** The name a reset leaves — the same word a Google or Yandex login falls back to. */
export const RESET_USER_NAME = PROVIDER_NAME_FALLBACK;

/** A reason longer than this is refused: it is a note, not a letter. */
export const REASON_MAX_LENGTH = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the moderator reads when the server refuses. */
export const USER_ACTION_REFUSALS = Object.freeze({
  USER_NOT_FOUND: 'Пользователь не найден',
  REASON_REQUIRED: 'Укажите причину',
  REASON_TOO_LONG: `Причина длиннее ${REASON_MAX_LENGTH} символов — сократите её`,
  SELF_ACTION: 'Нельзя заблокировать или переименовать самого себя',
  PANEL_ACCOUNT: 'Это учётка панели. Её включает и отключает оператор, не эта кнопка',
  SERVICE_ACCOUNT: 'Это служебная учётка платформы — ей принадлежат карточки каталога. Её не блокируют и не переименовывают',
  PARTNER_WITH_ESTABLISHMENTS: 'У этого партнёра есть карточки заведений в каталоге или на модерации. Его блокировка решает и их судьбу — это отдельное решение, этой кнопкой его не заблокировать',
  RESTORE_FLAG_INVALID: 'Не понятно, возвращать ли отзывы: ожидается «да» или «нет»',
  ACCOUNT_DELETED: 'Человек удалил свою учётку. Удалённую учётку не блокируют, не включают и не переименовывают',
});

const refuse = (code, status) => new AppError(USER_ACTION_REFUSALS[code], status, code);

const assertUserId = (userId) => {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw refuse('USER_NOT_FOUND', 404);
  }
};

/**
 * The reason as written to the journal: trimmed, required, bounded.
 *
 * @param {*} raw
 * @returns {string}
 */
export const normalizeReason = (raw) => {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason) throw refuse('REASON_REQUIRED', 422);
  if (reason.length > REASON_MAX_LENGTH) throw refuse('REASON_TOO_LONG', 422);
  return reason;
};

// ============================================================================
// Reads
// ============================================================================

/**
 * A page of people. A viewer gets no names or contacts (adminUserModel) and
 * may not search: a search by name or address answers «is this person
 * registered here», which is exactly what the role must not learn.
 *
 * @param {Object} params
 * @returns {Promise<{users: Array, meta: Object}>}
 */
export const getUsers = async ({ page = 1, perPage = 20, search, status, viewer = false } = {}) => {
  const text = typeof search === 'string' ? search.trim() : '';
  if (viewer && text) {
    throw new AppError(
      'Поиск людей недоступен в режиме просмотра',
      403,
      'VIEWER_PERSON_SEARCH_FORBIDDEN',
    );
  }
  const effectiveStatus = status === 'active' || status === 'blocked' ? status : undefined;
  const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
  const currentPage = Math.max(page, 1);
  const filters = { search: text || undefined, status: effectiveStatus, viewer };

  const [users, total] = await Promise.all([
    AdminUserModel.getUsers(filters, effectivePerPage, (currentPage - 1) * effectivePerPage),
    AdminUserModel.countUsers(filters),
  ]);

  return {
    users: users.map((user) => ({ ...user, viewer_redacted: viewer })),
    meta: {
      total,
      page: currentPage,
      per_page: effectivePerPage,
      pages: Math.ceil(total / effectivePerPage),
    },
  };
};

/**
 * One person, with the latest block or unblock from the journal.
 *
 * @param {string} userId
 * @param {Object} [options]
 * @param {boolean} [options.viewer=false]
 * @returns {Promise<Object>}
 */
export const getUser = async (userId, { viewer = false } = {}) => {
  assertUserId(userId);
  const user = await AdminUserModel.getUserById(userId, { viewer });
  if (!user) throw refuse('USER_NOT_FOUND', 404);
  return { ...user, viewer_redacted: viewer };
};

// ============================================================================
// Actions
// ============================================================================

/**
 * Lock the account row for the transaction and check who it is.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @param {string} actorId
 * @param {Object} options
 * @param {boolean} options.refusePartnerWithEstablishments
 * @returns {Promise<Object>} { id, name, role, is_active, is_service_account }
 */
const lockTarget = async (client, userId, actorId, { refusePartnerWithEstablishments }) => {
  const result = await client.query(
    `SELECT u.id, u.name, u.role, u.is_active,
            ${serviceAccountFlagSql('u')} AS is_service_account
     FROM users u
     WHERE u.id = $1
     FOR UPDATE`,
    [userId],
  );
  const target = result.rows[0];
  if (!target) throw refuse('USER_NOT_FOUND', 404);
  // Read under the row lock the deletion takes first: a deletion that held it
  // has committed its journal entry by now.
  if (await wasAccountDeleted(client, userId)) throw refuse('ACCOUNT_DELETED', 409);
  if (target.id === actorId) throw refuse('SELF_ACTION', 409);
  if (isPanelRole(target.role)) throw refuse('PANEL_ACCOUNT', 409);
  if (isOperatorManaged(target)) throw refuse('SERVICE_ACCOUNT', 409);

  if (refusePartnerWithEstablishments) {
    const cards = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM establishments WHERE partner_id = $1 AND status = ANY($2::text[])
       ) AS has_cards`,
      [userId, CATALOGUE_TRACK_STATUSES],
    );
    if (cards.rows[0].has_cards) throw refuse('PARTNER_WITH_ESTABLISHMENTS', 409);
  }
  return target;
};

/**
 * The journal entry, written in the action's own transaction. Unlike
 * AuditLogModel.createAuditLog it fails the action when it fails: the entry of
 * a block carries the list the unblock reads back.
 */
const writeAudit = async (client, { actorId, action, userId, oldData, newData, ipAddress, userAgent }) => {
  // created_at is clock_timestamp(), not the column's CURRENT_TIMESTAMP (the
  // start of the transaction) — see the module comment.
  const result = await client.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent, created_at)
     VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, clock_timestamp())
     RETURNING id`,
    [
      actorId,
      action,
      userId,
      JSON.stringify(oldData),
      JSON.stringify(newData),
      ipAddress || null,
      userAgent || null,
    ],
  );
  return result.rows[0].id;
};

/**
 * Run `work` in a transaction; after COMMIT drop the cached account status
 * (a lookup between the drop and the commit would cache the old value).
 */
const inTransaction = async (userId, work) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    if (result.changed) invalidateAccountStatus(userId);
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Recalculate the rating of every establishment whose reviews changed — the
 * service writes the rating last, not the schema trigger
 * (feedback_trigger_not_last_writer).
 *
 * @param {Object} client
 * @param {Array<{establishment_id: string}>} rows
 */
const recalcEstablishments = async (client, rows) => {
  const establishments = [...new Set(rows.map((row) => row.establishment_id))];
  for (const establishmentId of establishments) {
    await ReviewModel.updateEstablishmentAggregates(establishmentId, client);
  }
};

/**
 * Block a person: switch the account off, end its access, hide every visible
 * review of theirs, and journal the reason with the list of hidden reviews.
 *
 * @param {string} userId
 * @param {*} rawReason
 * @param {string} actorId
 * @param {Object} [request] - { ipAddress, userAgent }
 * @returns {Promise<{id: string, is_active: boolean, changed: boolean, hidden_reviews: number}>}
 */
export const blockUser = async (userId, rawReason, actorId, { ipAddress, userAgent } = {}) => {
  assertUserId(userId);
  const reason = normalizeReason(rawReason);

  const result = await inTransaction(userId, async (client) => {
    const target = await lockTarget(client, userId, actorId, { refusePartnerWithEstablishments: true });
    if (!target.is_active) {
      return { id: target.id, is_active: false, changed: false, hidden_reviews: 0 };
    }

    await client.query(
      'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [userId],
    );
    const hidden = await client.query(
      `UPDATE reviews SET is_visible = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND is_visible = TRUE AND is_deleted = FALSE
       RETURNING id, establishment_id`,
      [userId],
    );
    const access = await endAllAccess(client, userId);
    await recalcEstablishments(client, hidden.rows);

    await writeAudit(client, {
      actorId,
      action: 'user_block',
      userId,
      oldData: { is_active: true },
      newData: {
        is_active: false,
        reason,
        hidden_review_ids: hidden.rows.map((row) => row.id),
      },
      ipAddress,
      userAgent,
    });

    logger.info('Admin blocked user', {
      adminId: actorId,
      userId,
      hiddenReviews: hidden.rowCount,
      refreshTokens: access.tokenCount,
      devices: access.devices,
    });
    return { id: target.id, is_active: false, changed: true, hidden_reviews: hidden.rowCount };
  });

  return result;
};

/**
 * Whether the unblock shows the reviews again: yes unless the moderator said
 * no. A block is often made for the reviews themselves, and an unblock must
 * not bring back the review it was made for (Phase 3.5 lens review): the
 * moderator unticks «вернуть отзывы», and the reviews stay hidden as the
 * moderator's decision — no block is in force over them any more.
 *
 * @param {*} raw - body.restore_reviews
 * @returns {boolean}
 */
const normalizeRestoreFlag = (raw) => {
  if (raw === undefined || raw === null) return true;
  if (typeof raw !== 'boolean') throw refuse('RESTORE_FLAG_INVALID', 422);
  return raw;
};

/**
 * Unblock a person: switch the account on and show again the reviews the
 * latest block hid — those still hidden, not deleted, and not taken over by a
 * moderator one by one since the block. With restoreReviews false, none.
 *
 * A block in force without a list — switched off by the operator's script,
 * whose entry carries an empty one (or, before 2026-10-18, no entry at all) —
 * shows no review: the account is switched on, the reviews stay as they are.
 *
 * Sessions are ended on the way back too, as the operator's script does: an
 * account switched off before that rule may still hold sessions from before.
 *
 * @param {string} userId
 * @param {*} rawReason
 * @param {string} actorId
 * @param {Object} [request] - { ipAddress, userAgent, restoreReviews }
 * @returns {Promise<{id: string, is_active: boolean, changed: boolean, restored_reviews: number}>}
 */
export const unblockUser = async (
  userId,
  rawReason,
  actorId,
  { ipAddress, userAgent, restoreReviews: rawRestore } = {},
) => {
  assertUserId(userId);
  const reason = normalizeReason(rawReason);
  const restoreReviews = normalizeRestoreFlag(rawRestore);

  return inTransaction(userId, async (client) => {
    const target = await lockTarget(client, userId, actorId, { refusePartnerWithEstablishments: true });
    if (target.is_active) {
      return { id: target.id, is_active: true, changed: false, restored_reviews: 0 };
    }

    // The block in force: the latest of the block and unblock entries, if it
    // is a block. The entry is read under the lock of the account row, which
    // every block and unblock takes first.
    const latest = await client.query(
      `SELECT id, action, new_data -> 'hidden_review_ids' AS hidden_review_ids
       FROM audit_log
       WHERE entity_type = 'user' AND entity_id = $1 AND action IN ('user_block', 'user_unblock')
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [userId],
    );
    const block = latest.rows[0]?.action === 'user_block' ? latest.rows[0] : null;
    const hiddenIds = Array.isArray(block?.hidden_review_ids) ? block.hidden_review_ids : [];

    let restored = [];
    if (restoreReviews && hiddenIds.length > 0) {
      // A review a moderator showed or hid one by one after the block is the
      // moderator's decision. Times are compared in SQL, column to column:
      // created_at is a naive timestamp (feedback_timezone_axis_naive_timestamps).
      const shown = await client.query(
        `UPDATE reviews r SET is_visible = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE r.id = ANY($2::uuid[])
           AND r.user_id = $1
           AND r.is_visible = FALSE
           AND r.is_deleted = FALSE
           AND NOT EXISTS (
             SELECT 1 FROM audit_log moderated
             WHERE moderated.entity_type = 'review'
               AND moderated.entity_id = r.id
               AND moderated.action IN ('review_hide', 'review_show')
               AND moderated.created_at >= (SELECT created_at FROM audit_log WHERE id = $3)
           )
         RETURNING r.id, r.establishment_id`,
        [userId, hiddenIds, block.id],
      );
      restored = shown.rows;
    }

    await client.query(
      'UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = $1',
      [userId],
    );
    await endAllAccess(client, userId);
    await recalcEstablishments(client, restored);

    await writeAudit(client, {
      actorId,
      action: 'user_unblock',
      userId,
      oldData: { is_active: false },
      newData: {
        is_active: true,
        reason,
        restore_reviews: restoreReviews,
        restored_review_ids: restored.map((row) => row.id),
      },
      ipAddress,
      userAgent,
    });

    logger.info('Admin unblocked user', { adminId: actorId, userId, restoredReviews: restored.length });
    return { id: target.id, is_active: true, changed: true, restored_reviews: restored.length };
  });
};

/**
 * Reset a person's name to «Пользователь». The old name goes to the journal
 * under user_name — the key the viewer projection withholds.
 *
 * Partners are renamed too: the name is the person's, not the cards'.
 *
 * @param {string} userId
 * @param {*} rawReason
 * @param {string} actorId
 * @param {Object} [request] - { ipAddress, userAgent }
 * @returns {Promise<{id: string, name: string, changed: boolean}>}
 */
export const resetUserName = async (userId, rawReason, actorId, { ipAddress, userAgent } = {}) => {
  assertUserId(userId);
  const reason = normalizeReason(rawReason);

  return inTransaction(userId, async (client) => {
    const target = await lockTarget(client, userId, actorId, { refusePartnerWithEstablishments: false });
    if (target.name === RESET_USER_NAME) {
      return { id: target.id, name: target.name, changed: false };
    }

    await client.query(
      'UPDATE users SET name = $2, updated_at = NOW() WHERE id = $1',
      [userId, RESET_USER_NAME],
    );
    await writeAudit(client, {
      actorId,
      action: 'user_reset_name',
      userId,
      oldData: { user_name: target.name },
      newData: { user_name: RESET_USER_NAME, reason },
      ipAddress,
      userAgent,
    });

    logger.info('Admin reset user name', { adminId: actorId, userId });
    return { id: target.id, name: RESET_USER_NAME, changed: true };
  });
};
