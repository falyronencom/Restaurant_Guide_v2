/**
 * Service accounts — whose mailbox an account stands on.
 *
 * The accounts that hold the panel and the catalogue (the panel's admin and
 * viewers, the seed house that owns the platform's cards, the account given
 * to Apple's reviewers) were created by scripts on addresses at domains the
 * project does not own (2026-10-15, cloud critic 2B S1). Whoever owns such a
 * domain receives the system's mail to those accounts — password resets
 * included. The rule since then: a service account stands on a mailbox the
 * operator owns, and the scripts that create or move one refuse any other.
 *
 * "Ours" is one of two things:
 *   - an address at a domain the project owns (OUR_DOMAINS — named in the
 *     open repository, the project's own mail goes out from it);
 *   - the operator's own mailbox, named only in the operator's environment
 *     (SERVICE_ACCOUNT_MAILBOXES in backend/.env.production, gitignored) —
 *     never in the repository, which is public. Several service accounts
 *     cannot share one address (users_email_key), so on a provider that
 *     delivers «local+tag@» to «local@» — Gmail — the tagged forms of the
 *     mailbox are ours too. Only there: on a provider without sub-addressing
 *     «local+tag@» may be someone else's mailbox, and Yandex's own
 *     normalisation (below) strips the tag, so two accounts would collide.
 *
 * An address is compared, and stored, in the form the login looks it up by:
 * the e-mail chain of validateLogin (src/validators/authValidation.js) is run
 * on it as is — lower case, Yandex domains brought to yandex.ru, Gmail's dots
 * and tags kept, whatever the library version does next. An address written
 * in any other form would be one the login never finds.
 */

import { validationResult } from 'express-validator';
import { validateForgotPassword, validateLogin } from '../../src/validators/authValidation.js';

/** Domains the project owns (memory reference_production; DIRECTIVE 2026-10-15 p. 6). */
export const OUR_DOMAINS = Object.freeze(['nirivio.by', 'nirivio.com', 'nirivio.ru']);

/**
 * Domains the scripts have put service accounts on — none of them ours.
 * test.com and restaurantguide.by belong to strangers; example.com is
 * reserved for examples and has no mailbox. The audit lists every account on
 * them, whatever its role.
 */
export const SCRIPT_LITERAL_DOMAINS = Object.freeze(['test.com', 'restaurantguide.by', 'example.com']);

/** The operator's mailbox(es), comma-separated, in the operator's environment only. */
export const MAILBOXES_VARIABLE = 'SERVICE_ACCOUNT_MAILBOXES';

/** Providers on which «local+tag@domain» is delivered to «local@domain». */
const SUBADDRESSING_DOMAINS = Object.freeze(['gmail.com']);

/** How the audit prints the operator's mailbox: never its value. */
export const MAILBOX_LABEL = '[ящик Координатора]';

const loginEmailChain = validateLogin[0];
const forgotPasswordEmailChain = validateForgotPassword[0];

const runChain = async (chain, address) => {
  const req = { body: { email: address } };
  await chain.run(req);
  return validationResult(req).isEmpty() ? req.body.email : null;
};

/**
 * The address in the form the login looks it up by, or null when the login
 * would refuse it as malformed. The «forgot password» door normalises with
 * its own chain; an address the two doors would see differently is refused
 * too — a service account must be reachable by both or by neither.
 *
 * @param {string} address
 * @returns {Promise<string|null>}
 */
export async function loginFormOf(address) {
  if (typeof address !== 'string' || address.trim() === '') return null;
  const login = await runChain(loginEmailChain, address);
  const forgot = await runChain(forgotPasswordEmailChain, address);
  if (!login || login !== forgot) return null;
  return login;
}

/** @param {string} email @returns {string} the part after the last «@», lower case */
export const domainOf = (email) => String(email || '').slice(String(email || '').lastIndexOf('@') + 1).toLowerCase();

const localOf = (email) => String(email).slice(0, String(email).lastIndexOf('@'));

/**
 * The operator's mailboxes from the environment, each in its login form.
 *
 * @param {Object} [env=process.env]
 * @returns {Promise<string[]>}
 * @throws {Error} code SERVICE_MAILBOX_UNREADABLE — a listed value the login
 *   would not accept is a typo, not a mailbox
 */
export async function mailboxesFrom(env = process.env) {
  const raw = String(env[MAILBOXES_VARIABLE] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const mailboxes = [];
  for (const value of raw) {
    const form = await loginFormOf(value);
    if (!form) {
      const error = new Error(`${MAILBOXES_VARIABLE}: one of the values is not an address the login accepts.`);
      error.code = 'SERVICE_MAILBOX_UNREADABLE';
      throw error;
    }
    mailboxes.push(form);
  }
  return mailboxes;
}

/**
 * The operator's mailbox this address stands on — the mailbox itself, or its
 * tagged form on a provider that delivers it there — or null.
 *
 * @param {string} email - login form
 * @param {string[]} mailboxes - login forms (mailboxesFrom)
 * @returns {{mailbox: string, tag: string|null}|null}
 */
export function mailboxOf(email, mailboxes) {
  if (!email) return null;
  const lower = String(email).toLowerCase();
  for (const mailbox of mailboxes) {
    if (lower === mailbox) return { mailbox, tag: null };
    const domain = domainOf(mailbox);
    if (!SUBADDRESSING_DOMAINS.includes(domain) || domainOf(lower) !== domain) continue;
    const local = localOf(lower);
    const plus = local.indexOf('+');
    if (plus > 0 && local.slice(0, plus) === localOf(mailbox) && plus < local.length - 1) {
      return { mailbox, tag: local.slice(plus + 1) };
    }
  }
  return null;
}

/**
 * Whether an address is ours: at a domain we own, or on the operator's mailbox.
 *
 * @param {string} email - login form
 * @param {string[]} mailboxes
 * @returns {boolean}
 */
export const isOurAddress = (email, mailboxes) =>
  Boolean(email) && (OUR_DOMAINS.includes(domainOf(email)) || mailboxOf(email, mailboxes) !== null);

/**
 * An address as the operator's output may show it: the operator's mailbox is
 * replaced by a label (output is pasted into chats and reports); everything
 * else is shown as it is.
 *
 * @param {string|null} email
 * @param {string[]} mailboxes
 * @returns {string}
 */
export function displayAddress(email, mailboxes) {
  if (!email) return '(без e-mail)';
  const found = mailboxOf(email, mailboxes);
  if (!found) return email;
  return found.tag ? `${MAILBOX_LABEL}+${found.tag}` : MAILBOX_LABEL;
}

/**
 * An address of a person, for output: the domain stays, the name goes.
 *
 * @param {string|null} email
 * @returns {string}
 */
export function maskedAddress(email) {
  if (!email) return '(без e-mail)';
  const local = localOf(email);
  return `${local.slice(0, 1)}***@${domainOf(email)}`;
}
