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
 */

import pool from '../config/database.js';

/** How long one lookup answers for an account (ms). */
export const ACCOUNT_STATUS_TTL_MS = 10000;

/** Accounts remembered at most; the oldest write goes first. */
export const ACCOUNT_STATUS_MAX_ENTRIES = 10000;

/**
 * The account as the database has it.
 *
 * @param {string} userId
 * @returns {Promise<{isActive: boolean, role: string}|null>} null — no such account
 */
export const lookupAccountStatus = async (userId) => {
  const result = await pool.query('SELECT is_active, role FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) return null;
  return {
    isActive: result.rows[0].is_active === true,
    role: result.rows[0].role,
  };
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
 * @returns {Promise<{isActive: boolean, role: string}|null>}
 */
export const getAccountStatus = (userId) => cache.get(userId);

/**
 * Forget what is known about the account — call after the code changes its
 * role or switches it off, so the change applies from the next request.
 *
 * @param {string} userId
 */
export const invalidateAccountStatus = (userId) => cache.invalidate(userId);
