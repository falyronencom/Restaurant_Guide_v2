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
import { ACCOUNT_STATUS_TTL_MS, createAccountStatusCache } from '../../services/accountStatus.js';

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
