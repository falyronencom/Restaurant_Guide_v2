/**
 * Move an account to another address — the write of change-account-email.js,
 * here so that a test can drive it on the test database.
 *
 * Why it exists: the service accounts stood on addresses at domains the
 * project does not own (2026-10-15, cloud critic 2B S1) and nothing in the
 * code could change an account's e-mail — not the panel, not a script. The
 * move is the first protective step, so what it leaves behind matters as
 * much as the new address:
 *
 *   - the address is written in the form the login looks it up by
 *     (serviceAccounts.loginFormOf) — any other form and the operator is
 *     locked out of the account just moved;
 *   - only to an address of ours (serviceAccounts.isOurAddress — a mailbox
 *     the operator listed): a mistake is corrected by moving again, to
 *     another address of ours, never back to a stranger's domain. The
 *     operator's own way into the database (these scripts) stays whatever
 *     happens to the account;
 *   - everything that gave access under the old address ends with the move,
 *     in the same transaction: the PASSWORD and the phone (whoever owned the
 *     old domain could have set the password through a reset link — it must
 *     not outlive the move; the operator sets a new one right after, with
 *     set-partner-password.js / create-viewer.js / create-admin.js), sessions
 *     (refresh tokens burned, access tokens refused from the stamp), push
 *     devices, unused password-reset links and e-mail codes — mailed to the
 *     old address — and a Google/Yandex link: a provider login finds an
 *     account by the provider's id before its e-mail, so a link made earlier
 *     would outlive any change of address or password;
 *   - a request that found the account by its old address a moment before
 *     the commit — a «forgot password» whose link is written just after it —
 *     is caught by a second pass a few seconds later (secondPass);
 *   - the journal keeps the old and the new address, under user_email — a key
 *     the panel's viewer projection already withholds, so the operator's
 *     mailbox never reaches the read-only role.
 *
 * Only service accounts, unless the operator says otherwise: a panel account,
 * the flagged seed house, an account on a domain the scripts have used for
 * accounts (where the service accounts were put), or one already on our
 * mailbox (a correction). A person's account is moved only with
 * allowAnyAccount — moving it would lock them out of their own address.
 *
 * The id of the account does not change; nothing is deleted or re-created
 * (a deleted seed house takes the catalogue with it — ON DELETE CASCADE).
 */

import { endAllSessions } from './operator-password.js';
import {
  SCRIPT_LITERAL_DOMAINS,
  displayAddress,
  domainOf,
  isOurAddress,
  loginFormOf,
} from './serviceAccounts.js';

/** What the journal names as the actor of a change made by this script. */
export const EMAIL_CHANGE_ACTOR = 'operator_script:change-account-email';

/**
 * How long after the commit the second pass runs. A request that read the
 * account by its old address just before the commit finishes its writes
 * within milliseconds after it (it was waiting on the row's lock); seconds
 * leave a wide margin and cost the operator nothing.
 */
export const SECOND_PASS_DELAY_MS = 3000;

const refusal = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

/** Why this account may be moved without allowAnyAccount — or null. */
const serviceReason = (account, mailboxes) => {
  if (account.role === 'admin' || account.role === 'viewer') return `panel account (${account.role})`;
  if (account.is_service_account) return 'service account (seed house)';
  if (SCRIPT_LITERAL_DOMAINS.includes(domainOf(account.email))) return `on a script domain (${domainOf(account.email)})`;
  if (isOurAddress(account.email, mailboxes)) return 'already on our mailbox (a correction)';
  return null;
};

/**
 * What a move would do — read only.
 *
 * @param {Object} client - pg client
 * @param {Object} request
 * @param {string} request.currentEmail - the address the account stands on now
 * @param {string} request.newEmail - as the operator typed it
 * @param {string[]} request.mailboxes - the operator's mailboxes (serviceAccounts.mailboxesFrom)
 * @param {boolean} [request.allowAnyAccount=false] - move a person's account too
 * @returns {Promise<Object>} the plan: account, from, to, reason
 * @throws {Error} with a code: EMAIL_CHANGE_NO_ACCOUNT, EMAIL_CHANGE_NOT_SERVICE,
 *   EMAIL_CHANGE_BAD_ADDRESS, EMAIL_CHANGE_NOT_OURS, EMAIL_CHANGE_SAME, EMAIL_CHANGE_TAKEN
 */
export async function planEmailChange(client, { currentEmail, newEmail, mailboxes, allowAnyAccount = false }) {
  const current = String(currentEmail || '').trim().toLowerCase();
  const found = await client.query(
    `SELECT u.id, u.email, u.name, u.role, u.is_active, u.auth_method,
            COALESCE((to_jsonb(u) ->> 'is_service_account')::boolean, false) AS is_service_account,
            (u.oauth_provider_id IS NOT NULL) AS provider_linked,
            (u.password_hash IS NOT NULL) AS has_password,
            (u.phone IS NOT NULL) AS has_phone,
            (SELECT COUNT(*)::int FROM establishments e WHERE e.partner_id = u.id) AS cards,
            (SELECT COUNT(*)::int FROM refresh_tokens rt WHERE rt.user_id = u.id AND rt.used_at IS NULL) AS refresh_tokens,
            (SELECT COUNT(*)::int FROM device_tokens dt WHERE dt.user_id = u.id AND dt.is_active = TRUE) AS devices,
            (SELECT COUNT(*)::int FROM password_reset_tokens pr WHERE pr.user_id = u.id AND pr.used_at IS NULL) AS reset_links,
            (SELECT COUNT(*)::int FROM email_verification_codes ev WHERE ev.user_id = u.id AND ev.used_at IS NULL) AS email_codes
     FROM users u
     WHERE lower(u.email) = $1`,
    [current],
  );
  if (found.rows.length !== 1) {
    throw refusal('EMAIL_CHANGE_NO_ACCOUNT', `No account stands on ${current ? displayAddress(current, mailboxes) : '(empty)'}.`);
  }
  const account = found.rows[0];

  const reason = serviceReason(account, mailboxes);
  if (!reason && !allowAnyAccount) {
    throw refusal(
      'EMAIL_CHANGE_NOT_SERVICE',
      'This is not a service account (not a panel account, not the seed house, not on a script domain, not on our mailbox): ' +
        'moving it would lock a person out of their own address. If that is intended, add --any-account.',
    );
  }

  const to = await loginFormOf(newEmail);
  if (!to) {
    throw refusal('EMAIL_CHANGE_BAD_ADDRESS', 'The new address is not one the login accepts.');
  }
  if (!isOurAddress(to, mailboxes)) {
    throw refusal(
      'EMAIL_CHANGE_NOT_OURS',
      'The new address is not ours: not a mailbox listed in SERVICE_ACCOUNT_MAILBOXES (nor its Gmail «+tag» form).',
    );
  }
  if (to === account.email.toLowerCase()) {
    throw refusal('EMAIL_CHANGE_SAME', 'The account already stands on this address.');
  }
  const taken = await client.query('SELECT id FROM users WHERE lower(email) = $1', [to]);
  if (taken.rows.length > 0) {
    throw refusal('EMAIL_CHANGE_TAKEN', 'Another account already stands on the new address.');
  }

  return { account, from: account.email, to, reason: reason || 'any account (--any-account)' };
}

/**
 * Make the move planned by planEmailChange — one transaction.
 *
 * @param {Object} client - pg client outside a transaction
 * @param {Object} plan - planEmailChange's result
 * @returns {Promise<{account: Object, ended: Object, emailCodes: number}>}
 * @throws {Error} code EMAIL_CHANGE_MOVED — the account no longer stands on
 *   the planned old address (changed meanwhile); nothing is written
 */
export async function applyEmailChange(client, plan) {
  await client.query('BEGIN');
  try {
    const moved = await client.query(
      `UPDATE users
          SET email = $1,
              email_verified = true,
              password_hash = NULL,
              phone = NULL,
              phone_verified = false,
              oauth_provider_id = NULL,
              auth_method = CASE WHEN auth_method IN ('google', 'yandex') THEN 'email' ELSE auth_method END,
              updated_at = NOW()
        WHERE id = $2 AND email = $3
        RETURNING id, email, role, is_active, auth_method`,
      [plan.to, plan.account.id, plan.from],
    );
    if (moved.rows.length === 0) {
      throw refusal('EMAIL_CHANGE_MOVED', 'The account no longer stands on the planned address; nothing was written.');
    }
    const ended = await endAllSessions(client, plan.account.id);
    const codes = await client.query(
      'UPDATE email_verification_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
      [plan.account.id],
    );
    await client.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
       VALUES (NULL, 'change_email', 'user', $1, $2, $3, NULL, $4)`,
      [
        plan.account.id,
        JSON.stringify({
          user_email: plan.from,
          auth_method: plan.account.auth_method,
          provider_linked: plan.account.provider_linked,
          had_password: plan.account.has_password,
        }),
        JSON.stringify({
          user_email: plan.to,
          actor: EMAIL_CHANGE_ACTOR,
          auth_method: moved.rows[0].auth_method,
          provider_linked: false,
          password_cleared: true,
          sessions_ended: ended.refreshTokens,
          devices_switched_off: ended.devices,
          reset_links_spent: ended.resetLinks,
          email_codes_spent: codes.rowCount,
        }),
        EMAIL_CHANGE_ACTOR,
      ],
    );
    await client.query('COMMIT');
    return { account: moved.rows[0], ended, emailCodes: codes.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * The second pass: end again, in one transaction, whatever a request that
 * found the account by its old address just before the move managed to write
 * just after it — a reset link (its mail went to the old address), a code, a
 * session. Run SECOND_PASS_DELAY_MS after applyEmailChange.
 *
 * @param {Object} client - pg client outside a transaction
 * @param {string} accountId
 * @returns {Promise<{ended: Object, emailCodes: number}>}
 */
export async function secondPass(client, accountId) {
  await client.query('BEGIN');
  try {
    const ended = await endAllSessions(client, accountId);
    const codes = await client.query(
      'UPDATE email_verification_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
      [accountId],
    );
    await client.query('COMMIT');
    return { ended, emailCodes: codes.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
