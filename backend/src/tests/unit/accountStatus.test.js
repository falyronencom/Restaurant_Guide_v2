/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: services/accountStatus.js — the cache authenticate asks on
 * every request.
 *
 * The lookup and the clock are the test's: the order in which lookups finish
 * cannot be arranged on a live database. Each ordering rule is paired with
 * "the cache does update" — a cache that never stores again passes the first
 * kind and fails the second (feedback_cache_write_ordering).
 */

import { jest } from '@jest/globals';
import {
  ACCOUNT_STATUS_TTL_MS,
  createAccountStatusCache,
  issuedBeforeRevocation,
  markSessionsRevoked,
} from '../../services/accountStatus.js';
import logger from '../../utils/logger.js';

const TTL = 10000;
const ACTIVE = { isActive: true, role: 'user' };
const SWITCHED_OFF = { isActive: false, role: 'user' };

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const build = ({ maxEntries = 100 } = {}) => {
  const clock = { now: 1000 };
  const lookup = jest.fn();
  const cache = createAccountStatusCache({ lookup, ttlMs: TTL, maxEntries, now: () => clock.now });
  return { cache, lookup, clock };
};

test('the window is 10 s — what the operator is told (scripts/set-user-active.js) and the report measured', () => {
  // Raising it widens the time a switched-off account keeps working; change
  // the script's message and the runbook together with this number.
  expect(ACCOUNT_STATUS_TTL_MS).toBe(10000);
});

describe('createAccountStatusCache', () => {
  test('a second request inside the window is answered from memory', async () => {
    const { cache, lookup, clock } = build();
    lookup.mockResolvedValue(ACTIVE);

    await expect(cache.get('u1')).resolves.toEqual(ACTIVE);
    clock.now += TTL - 1;
    await expect(cache.get('u1')).resolves.toEqual(ACTIVE);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test('after the window the account is looked up again, and the new answer is what is served next', async () => {
    const { cache, lookup, clock } = build();
    lookup.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(SWITCHED_OFF);

    await cache.get('u1');
    clock.now += TTL;
    await expect(cache.get('u1')).resolves.toEqual(SWITCHED_OFF);
    clock.now += 1;
    await expect(cache.get('u1')).resolves.toEqual(SWITCHED_OFF);

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('a clock moved back makes the answer stale, not forever fresh', async () => {
    const { cache, lookup, clock } = build();
    lookup.mockResolvedValue(ACTIVE);

    await cache.get('u1');
    clock.now -= 1;
    await cache.get('u1');

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('requests that arrive while a lookup is in flight share it', async () => {
    const { cache, lookup } = build();
    const pending = deferred();
    lookup.mockReturnValueOnce(pending.promise);

    const first = cache.get('u1');
    const second = cache.get('u1');
    pending.resolve(ACTIVE);

    await expect(first).resolves.toEqual(ACTIVE);
    await expect(second).resolves.toEqual(ACTIVE);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test('invalidate: the next request looks the account up again, inside the window', async () => {
    const { cache, lookup } = build();
    lookup.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce({ isActive: true, role: 'partner' });

    await cache.get('u1');
    cache.invalidate('u1');

    await expect(cache.get('u1')).resolves.toEqual({ isActive: true, role: 'partner' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('a lookup that began before an invalidation answers its waiter but is not stored', async () => {
    const { cache, lookup } = build();
    const before = deferred();
    lookup.mockReturnValueOnce(before.promise).mockResolvedValueOnce({ isActive: true, role: 'partner' });

    const inFlight = cache.get('u1');
    cache.invalidate('u1');
    before.resolve(ACTIVE);
    await expect(inFlight).resolves.toEqual(ACTIVE);

    // Not served from what the old lookup read: a fresh lookup answers.
    await expect(cache.get('u1')).resolves.toEqual({ isActive: true, role: 'partner' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('a request after an invalidation does not join the lookup started before it', async () => {
    const { cache, lookup } = build();
    const before = deferred();
    lookup.mockReturnValueOnce(before.promise).mockResolvedValueOnce(SWITCHED_OFF);

    const old = cache.get('u1');
    cache.invalidate('u1');
    const fresh = cache.get('u1');

    await expect(fresh).resolves.toEqual(SWITCHED_OFF);
    before.resolve(ACTIVE);
    await old;
    expect(lookup).toHaveBeenCalledTimes(2);

    // The late old answer did not overwrite the fresh one.
    await expect(cache.get('u1')).resolves.toEqual(SWITCHED_OFF);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('a failed lookup is not stored: the waiter gets the error, the next request tries again', async () => {
    const { cache, lookup } = build();
    lookup.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(ACTIVE);

    await expect(cache.get('u1')).rejects.toThrow('db down');
    await expect(cache.get('u1')).resolves.toEqual(ACTIVE);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('accounts are kept apart, and when the cache is full the oldest goes first', async () => {
    const { cache, lookup } = build({ maxEntries: 2 });
    lookup.mockImplementation(async (userId) => ({ isActive: true, role: userId }));

    await cache.get('a');
    await cache.get('b');
    await cache.get('c'); // 'a' is pushed out
    expect(lookup).toHaveBeenCalledTimes(3);

    await expect(cache.get('c')).resolves.toEqual({ isActive: true, role: 'c' });
    expect(lookup).toHaveBeenCalledTimes(3);

    await expect(cache.get('a')).resolves.toEqual({ isActive: true, role: 'a' });
    expect(lookup).toHaveBeenCalledTimes(4);
  });
});

describe('issuedBeforeRevocation — the one rule for access and refresh tokens', () => {
  const STAMP = new Date('2026-10-12T09:00:00.123Z');

  test('the boundary pair: one millisecond before the stamp is refused, the stamp itself is not', () => {
    expect(issuedBeforeRevocation(STAMP.getTime() - 1, STAMP)).toBe(true);
    expect(issuedBeforeRevocation(STAMP.getTime(), STAMP)).toBe(false);
    expect(issuedBeforeRevocation(STAMP.getTime() + 1, STAMP)).toBe(false);
  });

  test('an account whose sessions were never revoked refuses nothing', () => {
    expect(issuedBeforeRevocation(0, null)).toBe(false);
    expect(issuedBeforeRevocation(0, undefined)).toBe(false);
  });
});

describe('markSessionsRevoked — the stamp, written in the caller\'s transaction', () => {
  const fakeClient = (onUpdate) => {
    const client = {
      query: jest.fn(async (sql, params) => {
        if (sql.startsWith('UPDATE users')) return onUpdate(sql, params);
        return { rows: [], rowCount: 0 };
      }),
    };
    return client;
  };
  const statements = (client) => client.query.mock.calls.map(([sql]) => sql);

  test('writes the process clock under a savepoint and never moves the stamp back', async () => {
    const client = fakeClient(async () => ({ rows: [], rowCount: 1 }));
    const before = Date.now();

    const revokedAt = await markSessionsRevoked(client, 'user-1');

    expect(revokedAt).toBeInstanceOf(Date);
    expect(revokedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(revokedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(statements(client)).toEqual([
      'SAVEPOINT sessions_revoked_at',
      'UPDATE users SET sessions_revoked_at = GREATEST(sessions_revoked_at, $2) WHERE id = $1',
      'RELEASE SAVEPOINT sessions_revoked_at',
    ]);
    // The very Date it reports is the one written — the stamp tokens are held to.
    expect(client.query.mock.calls[1][1]).toEqual(['user-1', revokedAt]);
  });

  test('before migration 035: the write is skipped, the transaction carries on, the log says why', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const client = fakeClient(async () => {
      throw Object.assign(new Error('column "sessions_revoked_at" does not exist'), { code: '42703' });
    });

    await expect(markSessionsRevoked(client, 'user-1')).resolves.toBeNull();

    expect(statements(client)).toEqual([
      'SAVEPOINT sessions_revoked_at',
      'UPDATE users SET sessions_revoked_at = GREATEST(sessions_revoked_at, $2) WHERE id = $1',
      'ROLLBACK TO SAVEPOINT sessions_revoked_at',
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('migration 035 is not applied'),
      { userId: 'user-1' },
    );
  });

  test('any other failure is the caller\'s: rethrown, the savepoint left to the caller\'s ROLLBACK', async () => {
    const client = fakeClient(async () => {
      throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    });

    await expect(markSessionsRevoked(client, 'user-1')).rejects.toThrow('lock timeout');
    expect(statements(client)).not.toContain('ROLLBACK TO SAVEPOINT sessions_revoked_at');
  });
});
