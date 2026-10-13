/**
 * Account status — whether an account may still act, and as what.
 *
 * An access token is valid for hours (utils/jwt.js, JWT_ACCESS_EXPIRY = 4h)
 * and carries the role it was issued with. Until 2026-10-07 authenticate
 * trusted it as is: an account switched off (users.is_active = false) or
 * given another role kept acting under the old token until it expired.
 * Now authenticate asks this module on every request, and the database
 * decides: a switched-off or missing account is refused, and the role is
 * the one in users.role, not the one in the token.
 *
 * Cost and freshness. One primary-key lookup per account, cached in this
 * process for ACCOUNT_STATUS_TTL_MS — a burst of requests from one app
 * (a screen fires several at once) costs one lookup. Where the code itself
 * changes a role (upgrade to partner, claim), it calls
 * invalidateAccountStatus and the change applies from the next request.
 * A change made in the database by hand (an operator switching an account
 * off) applies within ACCOUNT_STATUS_TTL_MS. The cache is per process: with
 * several instances each one holds its own, and the same bound applies.
 *
 * The cache follows the three rules of feedback_cache_write_ordering: the
 * write is conditional (a lookup that started before an invalidation does not
 * store what it read), freshness is counted from the end of the lookup, and a
 * negative age (the clock moved back) is stale, not "forever fresh".
 *
 * Revoked sessions (2026-10-12, migration 035). A password reset, a detected
 * refresh-token reuse and the takeover of an unconfirmed record end every
 * session of the account at once: its refresh tokens are burned (or deleted)
 * and users.sessions_revoked_at is stamped (markSessionsRevoked). A token
 * issued before the stamp is refused — an access token by authenticate, a
 * refresh token by authService.refreshAccessToken — by one rule,
 * issuedBeforeRevocation. Until then the access tokens of such an account
 * kept working up to their 4-hour expiry.
 *
 * The column may not exist yet: production applies migrations by hand after
 * the code deploys, and a column named in a query fails that query — here,
 * every authenticated request — until it does. So it is read through
 * to_jsonb(users), where a missing key is NULL, and written under a savepoint
 * that lets "no such column" pass.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/** How long one lookup answers for an account (ms). */
export const ACCOUNT_STATUS_TTL_MS = 10000;

/** Accounts remembered at most; the oldest write goes first. */
export const ACCOUNT_STATUS_MAX_ENTRIES = 10000;

/** PostgreSQL undefined_column: the schema predates migration 035. */
const UNDEFINED_COLUMN = '42703';

/**
 * The account as the database has it.
 *
 * sessionsRevokedAt is null for an account whose sessions were never revoked,
 * and for every account while migration 035 is not applied (see the module
 * comment for why it is read through to_jsonb).
 *
 * @param {string} userId
 * @returns {Promise<{isActive: boolean, role: string, sessionsRevokedAt: Date|null}|null>}
 *   null — no such account
 */
export const lookupAccountStatus = async (userId) => {
  const result = await pool.query(
    `SELECT is_active, role,
            (to_jsonb(users) ->> 'sessions_revoked_at')::timestamptz AS sessions_revoked_at
     FROM users
     WHERE id = $1`,
    [userId],
  );
  if (result.rows.length === 0) return null;
  return {
    isActive: result.rows[0].is_active === true,
    role: result.rows[0].role,
    sessionsRevokedAt: result.rows[0].sessions_revoked_at,
  };
};

/**
 * Whether a token was issued before the account's sessions were revoked.
 *
 * The millisecond of the stamp itself belongs to the new side: issued at the
 * stamp — valid, one millisecond earlier — refused. A tie is reachable in
 * theory only: a token minted before the revocation is separated from the
 * stamp by its refresh's claim and the burn, a token minted after it by at
 * least the commit — a database round trip each. It goes to the new side
 * because the takeover of an unconfirmed record issues the new holder's
 * tokens right after its own stamp.
 *
 * @param {number} issuedAtMs - When the token was issued, ms since the epoch
 * @param {Date|null|undefined} sessionsRevokedAt - users.sessions_revoked_at
 * @returns {boolean}
 */
export const issuedBeforeRevocation = (issuedAtMs, sessionsRevokedAt) =>
  sessionsRevokedAt instanceof Date && issuedAtMs < sessionsRevokedAt.getTime();

/**
 * Stamp users.sessions_revoked_at: every token issued until now is refused.
 *
 * Runs inside the caller's transaction, AFTER the caller has burned or deleted
 * the account's refresh tokens. A refresh racing the revocation then either
 * claimed its token before the burn — and the access token it minted before
 * claiming is older than this stamp — or finds its token burned and gets
 * nothing.
 *
 * The clock is the process's, like the issue time inside the tokens the stamp
 * is compared with — not the database's. GREATEST keeps the stamp from moving
 * back (two revocations racing, the clock stepping back).
 *
 * Before migration 035 the column does not exist: the write is made under a
 * savepoint, "undefined column" rolls back to it, and the caller's transaction
 * carries on — the refresh tokens are still revoked, the access tokens live
 * out their TTL as they did before 035. Any other error is the caller's.
 *
 * The caller drops the cached status (invalidateAccountStatus) after COMMIT:
 * a lookup between the drop and the commit would cache the old value.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @returns {Promise<Date|null>} the stamp written; null when the column is missing
 */
export const markSessionsRevoked = async (client, userId) => {
  const revokedAt = new Date();
  await client.query('SAVEPOINT sessions_revoked_at');
  try {
    await client.query(
      'UPDATE users SET sessions_revoked_at = GREATEST(sessions_revoked_at, $2) WHERE id = $1',
      [userId, revokedAt],
    );
  } catch (error) {
    if (error.code !== UNDEFINED_COLUMN) throw error;
    await client.query('ROLLBACK TO SAVEPOINT sessions_revoked_at');
    logger.warn('Sessions revoked without refusing access tokens: migration 035 is not applied', {
      userId,
    });
    return null;
  }
  await client.query('RELEASE SAVEPOINT sessions_revoked_at');
  return revokedAt;
};

/**
 * A cache over `lookup`. Exported for the unit tests, which drive the clock
 * and the order in which lookups finish.
 *
 * @param {Object} deps
 * @param {(userId: string) => Promise<Object|null>} deps.lookup
 * @param {number} deps.ttlMs
 * @param {number} deps.maxEntries
 * @param {() => number} [deps.now]
 */
export const createAccountStatusCache = ({ lookup, ttlMs, maxEntries, now = Date.now }) => {
  const entries = new Map(); // userId → { value, storedAt }
  const inflight = new Map(); // userId → promise of the lookup in flight
  const invalidatedAt = new Map(); // userId → sequence number of the last invalidation
  let sequence = 0;

  const isFresh = (entry) => {
    const age = now() - entry.storedAt;
    return age >= 0 && age < ttlMs;
  };

  const store = (userId, value) => {
    entries.delete(userId);
    entries.set(userId, { value, storedAt: now() });
    if (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  };

  const get = (userId) => {
    const entry = entries.get(userId);
    if (entry && isFresh(entry)) return Promise.resolve(entry.value);

    const pending = inflight.get(userId);
    if (pending) return pending;

    const startedAt = ++sequence;
    const promise = lookup(userId)
      .then((value) => {
        // Invalidated after this lookup began: what it read may predate the
        // change — answer the waiters, do not store it.
        if (startedAt > (invalidatedAt.get(userId) ?? 0)) {
          store(userId, value);
        }
        return value;
      })
      .finally(() => {
        if (inflight.get(userId) === promise) inflight.delete(userId);
      });
    inflight.set(userId, promise);
    return promise;
  };

  const invalidate = (userId) => {
    entries.delete(userId);
    inflight.delete(userId);
    invalidatedAt.set(userId, ++sequence);
  };

  return { get, invalidate };
};

const cache = createAccountStatusCache({
  lookup: lookupAccountStatus,
  ttlMs: ACCOUNT_STATUS_TTL_MS,
  maxEntries: ACCOUNT_STATUS_MAX_ENTRIES,
});

/**
 * @param {string} userId
 * @returns {Promise<{isActive: boolean, role: string, sessionsRevokedAt: Date|null}|null>}
 */
export const getAccountStatus = (userId) => cache.get(userId);

/**
 * Forget what is known about the account — call after the code changes its
 * role, switches it off or revokes its sessions, so the change applies from
 * the next request.
 *
 * @param {string} userId
 */
export const invalidateAccountStatus = (userId) => cache.invalidate(userId);
