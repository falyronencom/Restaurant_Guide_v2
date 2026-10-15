/**
 * Accounts whose access only the operator restores.
 *
 * Two kinds (directive service_accounts 2026-10-15, B1–B3; cloud critic 2B
 * S1, S2):
 *   - panel accounts — roles admin and viewer (config/panelRoles.js). They
 *     get a session through the panel's own login only, with its role gate
 *     and its rate limit; the shared password login and Google/Yandex
 *     sign-in do not open a session for them;
 *   - service accounts — users.is_service_account (migration 037): the seed
 *     house, which owns the platform's cards. It signs in to the partner
 *     cabinet by password, and by password only.
 * For both, «forgot password» issues nothing and Google/Yandex is never
 * linked: whoever controls the mailbox or the provider account must not be
 * able to take over the panel or the catalogue. A new password comes from the
 * operator's scripts (scripts/set-partner-password.js, create-viewer.js,
 * create-admin.js), which end every session as they set it.
 *
 * The flag is read through to_jsonb(users): production applies migrations by
 * hand after the code deploys, and a named column would fail every query that
 * reads it until then. A missing column reads as false — until 037 is applied
 * the rules hold for the panel roles only.
 */

import { isPanelRole } from './panelRoles.js';

/**
 * SQL for the flag of the users row under alias `alias` — false when the
 * column does not exist yet. The alias is a fixed identifier from the code,
 * never input.
 *
 * @param {string} alias
 * @returns {string}
 */
export const serviceAccountFlagSql = (alias) =>
  `COALESCE((to_jsonb(${alias}) ->> 'is_service_account')::boolean, false)`;

/**
 * Whether an account's access is restored only by the operator — a panel role
 * or the service flag.
 *
 * @param {{role: string, is_service_account?: boolean}} account
 * @returns {boolean}
 */
export const isOperatorManaged = (account) =>
  Boolean(account) && (isPanelRole(account.role) || account.is_service_account === true);
