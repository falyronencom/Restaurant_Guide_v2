/**
 * Account deletion — the person deletes their own account from the app or
 * the site (brief В1, 18.10.2026: App Store 5.1.1(v), Google Play, law 99-З);
 * a person without the app asks support, and the operator runs the same
 * deletion (scripts/delete-account.js).
 *
 * Deletion is anonymisation, not a DELETE of the users row (outside review
 * 23.09, item 36). The row is referenced by the person's cards
 * (establishments.partner_id cascades into thirteen tables, other people's
 * reviews among them), by the journal, by claims and moderation marks — a
 * DELETE would take down what is not the person's, leave ratings stale, or be
 * refused outright. So the row stays as an empty shell — id, role, auth
 * method, registration date, switched off — and everything that names the
 * person, or lets anyone in as them, goes.
 *
 * The Coordinator's decisions (18.10.2026, «да по рекомендации», brief §4):
 *   1. Reviews stay with their text and rating; the author reads «Гость»,
 *      without a picture. A review shows the author's name and avatar from the
 *      users row, so the row's name becomes DELETED_USER_NAME and its avatar
 *      goes; the reviews themselves are not touched — no rating moves.
 *   2. Bookings: the establishment keeps the date, the time and the number of
 *      guests; the name and the phone are wiped (the name lives on the users
 *      row; contact_phone is NOT NULL in the schema, so it becomes ''; the
 *      guest's comment goes with them — it is the guest's free text). A
 *      booking still ahead — pending, or confirmed and not yet come — is
 *      cancelled, and the establishment is told as when the guest cancels: a
 *      table held for a person nobody can reach any more helps no one.
 *   3. The holder of cards is not deleted until the cards are passed to
 *      someone else: the refusal says «напишите в поддержку». A card that was
 *      never public — a draft, or a rejected card with no published_at — is
 *      the person's unfinished work, not a card anyone would take over: it
 *      goes with the account, by the rule of the partner's own delete
 *      (EstablishmentModel.deleteEstablishment) and with its journal entry.
 *      One more condition here, because the deletion takes every such card
 *      at once and silently: nobody else has reviewed, favourited or booked
 *      it. The old seed script left published_at empty on cards that were
 *      public (Phase 3.5 lens review), and other people's traces are the
 *      proof the date cannot give; a card with them holds the account like a
 *      published one, and its reviews stay.
 *   4. The confirmation is the word УДАЛИТЬ — it works for an account without
 *      a password (Google, Yandex). The server checks it too: an accidental
 *      call must not delete anyone.
 *
 * Signing in again. E-mail, phone, password hash and provider id are cleared
 * and the account is switched off: a password login finds no account
 * (authService.verifyCredentials looks among active accounts by e-mail or
 * phone), Google and Yandex find no record by provider id or by e-mail and
 * open a NEW account, «forgot password» finds nobody. A login that read the
 * record before the deletion committed writes nothing into it afterwards
 * (authService: every write of a provider login requires is_active), and a
 * token minted for this record in such a race is refused by is_active
 * (middleware/auth.js, refreshAccessToken). The sessions: refresh tokens are
 * deleted, not burned — a burned token presented later reads as token reuse
 * (takeOverUnverifiedAccount explains) — and users.sessions_revoked_at is
 * stamped after that (accountStatus.markSessionsRevoked); the cached status is
 * dropped after COMMIT.
 *
 * The mark of a deleted account is its journal entry, user_delete_account,
 * written in the same transaction — no new column, as the panel's block keeps
 * its list in its own entry (adminUserService). The panel reads it to refuse
 * blocking, switching on or renaming the shell (wasAccountDeleted).
 *
 * Not deleted here: panel accounts and service accounts — their access is the
 * operator's (config/serviceAccounts.js).
 *
 * The texts are Russian: the app shows the server's message as it is.
 */

import pool, { getClient } from '../config/database.js';
import { deleteImage, ownCloudPublicId, ownedFolders } from '../config/cloudinary.js';
import { isOperatorManaged, serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { AppError } from '../middleware/errorHandler.js';
import { writeAuditLogInTransaction } from '../models/auditLogModel.js';
import { BOOKING_TIME_ZONE } from '../models/bookingModel.js';
import { invalidateAccountStatus, markSessionsRevoked } from './accountStatus.js';
import * as NotificationService from './notificationService.js';
import logger from '../utils/logger.js';

/** The author of a deleted account's reviews — decision 1. */
export const DELETED_USER_NAME = 'Гость';

/** The word that confirms the deletion — decision 4. */
export const DELETION_CONFIRMATION_WORD = 'УДАЛИТЬ';

/** Where the refusals send the person. */
export const SUPPORT_EMAIL = 'support@nirivio.by';

/** The journal action that marks a deleted account. */
export const ACCOUNT_DELETED_ACTION = 'user_delete_account';

/**
 * Card statuses that, with no published_at, are unfinished work — the rule of
 * the partner's own delete (EstablishmentModel.deleteEstablishment).
 */
const UNFINISHED_CARD_STATUSES = Object.freeze(['draft', 'rejected']);

/** What the person reads when the server refuses. */
export const ACCOUNT_DELETION_REFUSALS = Object.freeze({
  CONFIRMATION_REQUIRED: `Чтобы удалить учётку, введите слово ${DELETION_CONFIRMATION_WORD}`,
  ACCOUNT_OWNS_ESTABLISHMENTS: 'У вас есть карточки заведений. Удалить учётку можно, когда их передадут '
    + `другому владельцу, — напишите в поддержку: ${SUPPORT_EMAIL}`,
  ACCOUNT_OPERATOR_MANAGED: `Эту учётку удаляет оператор платформы. Напишите в поддержку: ${SUPPORT_EMAIL}`,
  ACCOUNT_INACTIVE: `Учётка отключена. Напишите в поддержку: ${SUPPORT_EMAIL}`,
  USER_NOT_FOUND: 'Учётка не найдена',
});

const refuse = (code, status) => new AppError(ACCOUNT_DELETION_REFUSALS[code], status, code);

/**
 * Whether the confirmation is the word: case and surrounding spaces aside.
 *
 * @param {*} raw - body.confirmation
 * @returns {boolean}
 */
export const isDeletionConfirmed = (raw) =>
  typeof raw === 'string' && raw.trim().toUpperCase() === DELETION_CONFIRMATION_WORD;

/**
 * Whether the account was deleted — its journal entry exists.
 *
 * @param {Object} db - pool or a client inside a transaction
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const wasAccountDeleted = async (db, userId) => {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM audit_log
       WHERE entity_type = 'user' AND entity_id = $1 AND action = $2
     ) AS deleted`,
    [userId, ACCOUNT_DELETED_ACTION],
  );
  return result.rows[0].deleted === true;
};

/**
 * Whether the person holds a card that is not unfinished work — the one
 * decision 3 keeps the account for. The check's reading of the rule that
 * anonymiseAccount applies in SQL (the DELETE of unfinished cards, then «is
 * any card left»); the tests of every card status hold both to one answer.
 *
 * @param {Array<{status: string, was_public: boolean, used_by_others: boolean}>} cards
 * @returns {boolean}
 */
const ownsCatalogueCards = (cards) => cards.some(
  (card) => !(UNFINISHED_CARD_STATUSES.includes(card.status)
    && !card.was_public
    && !card.used_by_others),
);

/**
 * SQL: someone other than the person ($1) has reviewed, favourited or booked
 * the card under alias `alias` — a fixed identifier from the code, never
 * input. One fragment for the check and the DELETE, so the two cannot drift.
 *
 * @param {string} alias
 * @returns {string}
 */
const usedByOthersSql = (alias) => `(
  EXISTS (SELECT 1 FROM reviews r WHERE r.establishment_id = ${alias}.id AND r.user_id <> $1)
  OR EXISTS (SELECT 1 FROM favorites f WHERE f.establishment_id = ${alias}.id AND f.user_id <> $1)
  OR EXISTS (SELECT 1 FROM bookings b WHERE b.establishment_id = ${alias}.id AND b.user_id <> $1)
)`;

/**
 * Why this account may not be deleted from the app or the site, whatever it
 * holds, or null.
 *
 * A switched-off account comes first: it reaches here only while another
 * server instance still caches it as active (accountStatus, 10 s).
 *
 * @param {Object} account - { is_active, role, is_service_account }
 * @returns {string|null} a key of ACCOUNT_DELETION_REFUSALS
 */
const accountRefusal = (account) => {
  if (!account.is_active) return 'ACCOUNT_INACTIVE';
  if (isOperatorManaged(account)) return 'ACCOUNT_OPERATOR_MANAGED';
  return null;
};

const ACCOUNT_SQL = `
  SELECT u.id, u.role, u.auth_method, u.is_active, u.avatar_url,
         ${serviceAccountFlagSql('u')} AS is_service_account
  FROM users u
  WHERE u.id = $1`;

const CARDS_SQL = `
  SELECT e.id, e.status, e.published_at IS NOT NULL AS was_public,
         ${usedByOthersSql('e')} AS used_by_others
  FROM establishments e
  WHERE e.partner_id = $1`;

/**
 * Whether a card holds the account (decision 3), read before the deletion —
 * by the screen's question below and by the operator script before it asks
 * «yes». anonymiseAccount applies the rule again, in its transaction.
 *
 * @param {Object} db - pool or a client
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const holdsCatalogueCards = async (db, userId) =>
  ownsCatalogueCards((await db.query(CARDS_SQL, [userId])).rows);

/**
 * Whether the account may be deleted now, and if not — why, in the words the
 * person reads. The screen asks before it shows the confirmation, so that a
 * holder of cards is told «напишите в поддержку» before typing the word.
 * deleteAccount applies the same rule again, in its transaction.
 *
 * @param {string} userId
 * @returns {Promise<{allowed: boolean, refusal: {code: string, message: string}|null}>}
 */
export const getDeletionCheck = async (userId) => {
  const account = (await pool.query(ACCOUNT_SQL, [userId])).rows[0];
  if (!account) throw refuse('USER_NOT_FOUND', 404);

  const code = accountRefusal(account)
    ?? (await holdsCatalogueCards(pool, userId) ? 'ACCOUNT_OWNS_ESTABLISHMENTS' : null);
  return {
    allowed: code === null,
    refusal: code === null ? null : { code, message: ACCOUNT_DELETION_REFUSALS[code] },
  };
};

/**
 * The establishments to tell about bookings the deletion cancelled — after
 * COMMIT, without blocking the answer, as bookingService.cancelBooking does.
 *
 * @param {Array<Object>} cancelled - rows of the cancelling UPDATE
 */
const notifyCancelledBookings = (cancelled) => {
  for (const booking of cancelled) {
    if (!booking.partner_id) continue;
    NotificationService.notifyBookingCancelled(
      booking.partner_id,
      {
        id: booking.id,
        establishment_name: booking.establishment_name,
        booking_date: booking.booking_date,
        booking_time: booking.booking_time,
      },
      booking.establishment_id,
    ).catch(() => {});
  }
};

/**
 * Lock the account row for the caller's transaction and read it — the first
 * statement of every deletion: every other writer of this account (the
 * panel's block, a review's FOR SHARE check, a second deletion, a provider
 * login's write) queues behind it.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @returns {Promise<Object|undefined>} { id, role, auth_method, is_active, avatar_url, is_service_account }
 */
export const lockAccount = async (client, userId) =>
  (await client.query(`${ACCOUNT_SQL} FOR UPDATE`, [userId])).rows[0];

/**
 * The deletion itself — see the module comment for what goes and what stays —
 * inside the caller's transaction, on the row the caller locked (lockAccount)
 * and judged deletable. Throws ACCOUNT_OWNS_ESTABLISHMENTS when a card holds
 * the account; the caller rolls back, and nothing of the deletion stays.
 *
 * Two callers: deleteAccount below (the person, from the app or the site) and
 * the operator's script scripts/delete-account.js (a request to support from a
 * person without the app). Who deleted goes to the journal: the person's id,
 * or no id and the script's name.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {Object} account - the locked row (lockAccount)
 * @param {Object} by - { userId } the person; { userId: null, label } a script
 * @returns {Promise<{counts: Object, cancelled: Array<Object>}>} the counts as
 *   journalled; the bookings it cancelled, for the notices after COMMIT
 */
export const anonymiseAccount = async (client, account, { userId: actorId = null, label = null } = {}) => {
  const userId = account.id;

  // Unfinished cards go first — the rule of the partner's own delete, in the
  // DELETE itself, plus «nobody else has used it» (module comment, 3); each
  // card with that delete's journal entry (the audit screen has nothing to
  // join a deleted card to: name and city are kept in old_data). A draft
  // being sent to moderation at this moment holds its row: the DELETE waits
  // for it and, finding it pending, leaves it.
  const drafts = await client.query(
    `WITH deleted AS (
       DELETE FROM establishments e
       WHERE e.partner_id = $1
         AND e.status = ANY($2::text[])
         AND e.published_at IS NULL
         AND NOT ${usedByOthersSql('e')}
       RETURNING e.id, e.name, e.city, e.status
     ), logged AS (
       INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data)
       SELECT $3::uuid, 'partner_delete_establishment', 'establishment', d.id,
              jsonb_build_object('name', d.name, 'city', d.city, 'status', d.status)
         FROM deleted d
       RETURNING entity_id
     )
     SELECT COUNT(*)::int AS n FROM logged`,
    [userId, UNFINISHED_CARD_STATUSES, actorId],
  );

  // What is left is a card that is, was or is about to be in the catalogue —
  // decision 3: the account stays until the card has another holder. The
  // refusal rolls back the drafts' deletion too.
  const kept = await client.query(
    'SELECT EXISTS (SELECT 1 FROM establishments WHERE partner_id = $1) AS owns',
    [userId],
  );
  if (kept.rows[0].owns) throw refuse('ACCOUNT_OWNS_ESTABLISHMENTS', 409);

  // Bookings still ahead are cancelled. «Ahead» is read on the Minsk clock
  // the booking was made on (bookingModel); a pending one past its deadline
  // is left to the lazy expiry, as it would be without the deletion.
  // booking_date and booking_time leave as text: the notice formats them,
  // and a DATE read into a JS Date shifts with the process time zone.
  const cancelled = (await client.query(
    `UPDATE bookings b
        SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       FROM establishments e
      WHERE e.id = b.establishment_id
        AND b.user_id = $1
        AND (
          (b.status = 'pending' AND b.expires_at >= NOW())
          OR (b.status = 'confirmed'
              AND ((b.booking_date + b.booking_time) AT TIME ZONE $2) > NOW())
        )
      RETURNING b.id, b.establishment_id, e.partner_id, e.name AS establishment_name,
                to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
                b.booking_time::text AS booking_time`,
    [userId, BOOKING_TIME_ZONE],
  )).rows;

  // Every booking keeps its date, time and guests; the phone and the
  // comment go (the name goes with the account row below).
  await client.query(
    `UPDATE bookings SET contact_phone = '', comment = NULL, updated_at = NOW()
     WHERE user_id = $1`,
    [userId],
  );

  // Favourites, then the counter of every card they were on — the counter
  // is denormalised (favoriteModel.updateEstablishmentFavoriteCount).
  const favorites = await client.query(
    'DELETE FROM favorites WHERE user_id = $1 RETURNING establishment_id',
    [userId],
  );
  const favoriteCards = [...new Set(favorites.rows.map((row) => row.establishment_id))];
  if (favoriteCards.length > 0) {
    await client.query(
      `UPDATE establishments e
          SET favorite_count = (SELECT COUNT(*) FROM favorites f WHERE f.establishment_id = e.id)
        WHERE e.id = ANY($1::uuid[])`,
      [favoriteCards],
    );
  }

  // What reached the person: notices, their settings, push devices, codes
  // and reset links.
  await client.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM notification_preferences WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM email_verification_codes WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);

  // Sessions. The successor link is a self-reference within the account's
  // own rows; cleared before they go.
  await client.query('UPDATE refresh_tokens SET replaced_by = NULL WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  // After the refresh tokens are gone, not before (markSessionsRevoked).
  const revokedAt = await markSessionsRevoked(client, userId);

  // A card that passed to another holder keeps its legal record; the
  // contact person and address in it were this person's.
  await client.query(
    `UPDATE partner_documents SET contact_person = NULL, contact_email = NULL
     WHERE partner_id = $1 AND (contact_person IS NOT NULL OR contact_email IS NOT NULL)`,
    [userId],
  );

  const reviews = await client.query(
    'SELECT COUNT(*)::int AS n FROM reviews WHERE user_id = $1 AND is_deleted = FALSE',
    [userId],
  );

  // The row itself: nothing in it names the person or lets anyone in.
  await client.query(
    `UPDATE users
        SET email = NULL, phone = NULL, password_hash = NULL, oauth_provider_id = NULL,
            name = $2, avatar_url = NULL,
            email_verified = FALSE, phone_verified = FALSE, last_login_at = NULL,
            is_active = FALSE, updated_at = NOW()
      WHERE id = $1`,
    [userId, DELETED_USER_NAME],
  );

  // The journal keeps what was done to the account, not who held it: the
  // name a reset replaced (adminUserService.resetUserName, user_name) and
  // the addresses an e-mail change wrote (scripts/lib/accountEmail.js,
  // user_email) leave its earlier entries. A moderator's reason stays as it
  // was written: it is the moderation record, free text the code cannot
  // take apart (Phase 3.5 review).
  await client.query(
    `UPDATE audit_log
        SET old_data = old_data - 'user_name' - 'user_email',
            new_data = new_data - 'user_name' - 'user_email'
      WHERE entity_type = 'user' AND entity_id = $1
        AND (old_data ?| ARRAY['user_name', 'user_email']
             OR new_data ?| ARRAY['user_name', 'user_email'])`,
    [userId],
  );

  const counts = {
    reviews_kept: reviews.rows[0].n,
    bookings_cancelled: cancelled.length,
    favorites_removed: favorites.rowCount,
    drafts_deleted: drafts.rows[0].n,
    access_tokens_revoked: revokedAt !== null,
  };

  // The mark of the deletion, and its record. No contact, no address, no IP:
  // the journal must not keep what the deletion erased.
  await writeAuditLogInTransaction(client, {
    user_id: actorId,
    action: ACCOUNT_DELETED_ACTION,
    entity_type: 'user',
    entity_id: userId,
    old_data: { role: account.role, auth_method: account.auth_method },
    new_data: label ? { ...counts, actor: label } : counts,
  });

  return { counts, cancelled };
};

/**
 * Delete the account of `userId` — the person, from the app or the site. One
 * transaction: an account left half-deleted (contacts gone, sessions alive,
 * or the other way round) is the defect itself.
 *
 * Repeating the request is harmless: the account row is locked first, and a
 * second request that finds it already deleted answers as the first did.
 *
 * @param {string} userId - the authenticated caller
 * @param {*} rawConfirmation - body.confirmation
 * @returns {Promise<{deleted: true, changed: boolean}>}
 */
export const deleteAccount = async (userId, rawConfirmation) => {
  if (!isDeletionConfirmed(rawConfirmation)) {
    throw refuse('CONFIRMATION_REQUIRED', 422);
  }

  const client = await getClient();
  let account;
  let outcome;
  try {
    await client.query('BEGIN');

    account = await lockAccount(client, userId);
    if (!account) throw refuse('USER_NOT_FOUND', 404);

    if (!account.is_active && await wasAccountDeleted(client, userId)) {
      await client.query('COMMIT');
      return { deleted: true, changed: false };
    }

    const refusal = accountRefusal(account);
    if (refusal) throw refuse(refusal, 409);

    outcome = await anonymiseAccount(client, account, { userId });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // The next request of any session reads the switched-off account.
  invalidateAccountStatus(userId);

  // The picture the person uploaded — only an asset on our cloud in their
  // own avatar folder (a Google or Yandex picture is not ours to delete) —
  // and the CDN's copies of it, which would otherwise outlive the file.
  const avatarPublicId = ownCloudPublicId(account.avatar_url);
  if (avatarPublicId) {
    deleteImage(avatarPublicId, [ownedFolders.avatars(userId)], { invalidate: true }).catch((error) => {
      logger.warn('Account deletion: avatar left on the cloud', { userId, error: error.message });
    });
  }

  notifyCancelledBookings(outcome.cancelled);

  logger.info('Account deleted by its holder', { userId, ...outcome.counts });
  return { deleted: true, changed: true };
};
