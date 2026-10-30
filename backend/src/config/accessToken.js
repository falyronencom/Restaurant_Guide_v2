/**
 * Access token lifetime
 *
 * Every role but the panel's lives JWT_ACCESS_EXPIRY ('4h' by default) —
 * read by jsonwebtoken, so a value means what jsonwebtoken makes of it: a
 * timespan string ('4h', '30m', '1d'), and a bare number of the env (always a
 * string there) is milliseconds, not seconds.
 *
 * The panel's accounts (config/panelRoles.js) get at most one hour
 * (Coordinator decision 2026-10-29, after S1 «а»): a stolen panel access
 * token is good for an hour, not four. The moderator does not see it —
 * admin-web renews on the 401 of an expired token by itself. Never longer
 * than JWT_ACCESS_EXPIRY: a variable set shorter shortens the panel too.
 *
 * A lifetime of a day or more is reported at startup: before the ceiling the
 * panel shared the variable, and its one-day idle limit (S1 «а», PR #155)
 * would have stopped working silently — a moderator at work would have been
 * renewing once a day, the idle check would have logged them out.
 *
 * resolveAccessTokenLifetime is pure: reads the env object it is given and
 * returns the warning instead of logging it — server.js logs it at startup.
 * accessTokenLifetime is the same for process.env, once per process.
 */

import jwt from 'jsonwebtoken';
import { PANEL_SESSION_IDLE_MS, isPanelRole } from './panelRoles.js';

/** Used when JWT_ACCESS_EXPIRY is absent. */
export const DEFAULT_ACCESS_EXPIRY = '4h';
const DEFAULT_ACCESS_SECONDS = 4 * 60 * 60;

/** The panel's ceiling, in seconds (Coordinator decision 2026-10-29). */
export const PANEL_ACCESS_TOKEN_MAX_SECONDS = 60 * 60;

/** From this lifetime on the variable is reported at startup: one day. */
export const ACCESS_EXPIRY_WARNING_SECONDS = PANEL_SESSION_IDLE_MS / 1000;

/**
 * The lifetime jsonwebtoken gives a token signed with this expiresIn, in
 * seconds, or null when it refuses the value. Asked of jsonwebtoken itself
 * rather than parsed here, so the two cannot disagree on a unit.
 *
 * @param {string|number} expiresIn
 * @returns {number|null}
 */
export const accessExpirySeconds = (expiresIn) => {
  try {
    const { iat, exp } = jwt.decode(jwt.sign({}, 'lifetime-probe', { expiresIn }));
    return Number.isFinite(exp) ? exp - iat : null;
  } catch {
    return null;
  }
};

/**
 * Resolve the access token lifetimes from the environment.
 *
 * @param {Object} [env] - Environment map (process.env in production)
 * @returns {{ expiresIn: string, seconds: number|null, panelSeconds: number,
 *   warning: string|null }} expiresIn is what the other roles' tokens are
 *   signed with, as before; seconds is its lifetime (null when jsonwebtoken
 *   refuses it — every such token then fails to sign, as before); warning is
 *   non-null from one day on, at zero or less, or on a refused value, and
 *   never carries the value
 */
export const resolveAccessTokenLifetime = (env = {}) => {
  const raw = env.JWT_ACCESS_EXPIRY;
  const expiresIn = raw === undefined || raw === null || String(raw).trim() === ''
    ? DEFAULT_ACCESS_EXPIRY
    : raw;
  const seconds = accessExpirySeconds(expiresIn);
  const panelSeconds = seconds === null
    ? PANEL_ACCESS_TOKEN_MAX_SECONDS
    : Math.min(PANEL_ACCESS_TOKEN_MAX_SECONDS, seconds);

  let warning = null;
  if (seconds === null) {
    warning = 'JWT_ACCESS_EXPIRY is not a timespan jsonwebtoken accepts (e.g. "4h"): '
      + 'tokens of every role outside the panel will fail to sign';
  } else if (seconds <= 0) {
    warning = `JWT_ACCESS_EXPIRY gives access tokens ${seconds} s: every token `
      + "of every role, the panel's too, is expired when issued";
  } else if (seconds >= ACCESS_EXPIRY_WARNING_SECONDS) {
    warning = `JWT_ACCESS_EXPIRY gives access tokens ${seconds} s, a day or more: `
      + 'an access token outside the panel keeps working that long without a '
      + 'renewal; the panel\'s own stay capped at '
      + `${PANEL_ACCESS_TOKEN_MAX_SECONDS} s, under its one-day idle limit`;
  }

  return { expiresIn, seconds, panelSeconds, warning };
};

/** process.env's, resolved on the first call and kept: see accessTokenLifetime. */
let processLifetime = null;

/**
 * The lifetimes of this process, from process.env. Resolved on the first call
 * — a token's signing or the startup line, both after the env is loaded
 * (dotenv in server.js and utils/jwt.js, .env.test in the tests) — and kept:
 * a token never changes its lifetime mid-run.
 *
 * @returns {ReturnType<typeof resolveAccessTokenLifetime>}
 */
export const accessTokenLifetime = () => {
  if (processLifetime === null) {
    processLifetime = resolveAccessTokenLifetime(process.env);
  }
  return processLifetime;
};

/**
 * How long an access token of this role lives, in seconds: the panel's
 * accounts at most an hour, every other role JWT_ACCESS_EXPIRY. What the
 * clients are told in expiresIn; the token carries the same as its exp
 * (utils/jwt.js generateAccessToken). A refused JWT_ACCESS_EXPIRY reports the
 * 4 h default — such a token never gets signed.
 *
 * @param {string} role - The account's role
 * @returns {number}
 */
export const accessTokenLifetimeSeconds = (role) => {
  const lifetime = accessTokenLifetime();
  if (isPanelRole(role)) {
    return lifetime.panelSeconds;
  }
  return lifetime.seconds ?? DEFAULT_ACCESS_SECONDS;
};
