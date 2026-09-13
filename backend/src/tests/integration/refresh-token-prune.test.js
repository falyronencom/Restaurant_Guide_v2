/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Refresh Token Prune Integration Tests
 *
 * Against a real database, because every fact here is a property of the
 * database rather than of the loop around it:
 *
 * - what the cutoff selects, and that the retention tail shifts it
 * - that a burned but UNEXPIRED row survives — the whole reuse-detection
 *   argument for pruning on expiry alone rests on this (config/refreshTokenPrune.js)
 * - that a rotation chain can be deleted at all despite refresh_tokens'
 *   self-referencing foreign key, and that a batch which cuts a chain in half
 *   still satisfies it
 * - that the cutoff rides the PROCESS clock, not the database session's
 *
 * The loop itself — batching, the per-tick cap, re-entrancy, stop() — is in
 * unit/refreshTokenPruner.test.js against a mocked pool.
 */

import { pruneOnce } from '../../services/refreshTokenPruner.js';
import { buildPruneCutoff } from '../../config/refreshTokenPrune.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** A Date `days` in the past on the PROCESS clock — the one expires_at uses. */
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

/**
 * Insert a refresh-token row directly.
 *
 * expires_at and created_at go in as JS Dates on purpose: that is how
 * generateTokenPair writes them, and the column is `timestamp without time
 * zone`, so the value lands in the process's local wall clock. A fixture that
 * wrote them in SQL would be testing a row shape production never produces.
 */
const insertToken = async (userId, { token, expiresAt, createdAt, usedAt = null, replacedBy = null }) => {
  const { rows } = await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, created_at, used_at, replaced_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, token, expiresAt, createdAt ?? expiresAt, usedAt, replacedBy],
  );
  return rows[0].id;
};

const survivingTokens = async (userId) => {
  const { rows } = await query(
    'SELECT token FROM refresh_tokens WHERE user_id = $1 ORDER BY expires_at',
    [userId],
  );
  return rows.map((row) => row.token);
};

let user;

beforeEach(async () => {
  await clearAllData();
  ({ user } = await createUserAndGetTokens(testUsers.regularUser));
  // createUserAndGetTokens leaves a live row of its own; drop it so each test
  // states its whole fixture and nothing survives by accident.
  await query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);
});

afterAll(async () => {
  await clearAllData();
});

describe('pruneOnce — what the cutoff selects', () => {
  test('deletes rows past the cutoff and leaves live ones alone', async () => {
    await insertToken(user.id, { token: 'long-expired', expiresAt: daysAgo(40) });
    await insertToken(user.id, { token: 'live', expiresAt: daysAgo(-10) });

    const deleted = await pruneOnce(buildPruneCutoff(7));

    expect(deleted).toBe(1);
    expect(await survivingTokens(user.id)).toEqual(['live']);
  });

  test('the retention tail keeps a row that expired inside it', async () => {
    // Expired, but only three days ago — a seven-day tail still owes it four.
    await insertToken(user.id, { token: 'inside-tail', expiresAt: daysAgo(3) });
    await insertToken(user.id, { token: 'past-tail', expiresAt: daysAgo(8) });

    const deleted = await pruneOnce(buildPruneCutoff(7));

    expect(deleted).toBe(1);
    expect(await survivingTokens(user.id)).toEqual(['inside-tail']);
  });

  test('a burned but unexpired row survives, so a replay still raises the alert', async () => {
    // This is the security argument for pruning on expiry alone: the burned
    // row is what makes a second presentation detectable, and it keeps its
    // full 30 days rather than the 60 seconds of the reuse grace window.
    await insertToken(user.id, {
      token: 'burned-yesterday',
      expiresAt: daysAgo(-29),
      createdAt: daysAgo(1),
      usedAt: daysAgo(1),
    });

    expect(await pruneOnce(buildPruneCutoff(7))).toBe(0);
    expect(await survivingTokens(user.id)).toEqual(['burned-yesterday']);
  });
});

describe('pruneOnce — the self-referencing foreign key', () => {
  /**
   * A rotation chain as refreshAccessToken builds one: each burned row points
   * at its successor via replaced_by, and each successor was issued later and
   * therefore expires later. Returns the tokens oldest-first.
   */
  const insertChain = async (length, { firstExpiredDaysAgo }) => {
    const tokens = [];
    let successorId = null;

    // Built newest-first so each row can name the successor it points at.
    for (let step = length - 1; step >= 0; step -= 1) {
      const token = `chain-${step}`;
      const expiredDaysAgo = firstExpiredDaysAgo - step;
      const id = await insertToken(user.id, {
        token,
        expiresAt: daysAgo(expiredDaysAgo),
        createdAt: daysAgo(expiredDaysAgo + 30),
        usedAt: successorId === null ? null : daysAgo(expiredDaysAgo + 29),
        replacedBy: successorId,
      });
      successorId = id;
      tokens.unshift(token);
    }

    return tokens;
  };

  test('deletes a whole rotation chain in one batch', async () => {
    // Deleting a successor while its predecessor still points at it violates
    // refresh_tokens_replaced_by_fkey. It works here only because NO ACTION
    // defers the check to the end of the statement and the whole chain is in
    // the same statement.
    await insertChain(4, { firstExpiredDaysAgo: 20 });

    expect(await pruneOnce(buildPruneCutoff(7))).toBe(4);
    expect(await survivingTokens(user.id)).toEqual([]);
  });

  test('a batch that cuts a chain in half deletes the older half and stays legal', async () => {
    // The batch limit lands mid-chain. Ordering oldest-first is what makes
    // that survivable: the rows left behind are the NEWER ones, which nothing
    // remaining points at. Ordered newest-first the same limit raises the
    // foreign key and the whole statement is lost.
    const tokens = await insertChain(4, { firstExpiredDaysAgo: 20 });

    expect(await pruneOnce(buildPruneCutoff(7), 2)).toBe(2);
    expect(await survivingTokens(user.id)).toEqual(tokens.slice(2));

    // And the remainder drains on the next pass rather than wedging.
    expect(await pruneOnce(buildPruneCutoff(7), 2)).toBe(2);
    expect(await survivingTokens(user.id)).toEqual([]);
  });
});

describe('pruneOnce — the clock the cutoff rides', () => {
  test('compares against the process clock, not the database session clock', async () => {
    // expires_at is written from a JS Date into a naive column, so it carries
    // the PROCESS's local wall clock. SQL NOW() returns the DATABASE session's.
    // A row one hour past its expiry with a zero tail is deleted on the first
    // clock; on the second — the sessions here run Etc/UTC while the process
    // is pinned to Europe/Minsk — it is three hours short of the cutoff and
    // would survive.
    const { rows } = await query('SELECT EXTRACT(EPOCH FROM (LOCALTIMESTAMP - $1::timestamp)) AS skew', [new Date()]);
    const skewSeconds = Math.abs(Number(rows[0].skew));

    // Without a skew the two clocks are the same clock and nothing here can
    // tell them apart. CI pins TZ=Europe/Minsk against a UTC database exactly
    // so this guard has teeth; say so rather than passing vacuously.
    expect(skewSeconds).toBeGreaterThan(HOUR_MS / 1000);

    await insertToken(user.id, { token: 'expired-an-hour-ago', expiresAt: new Date(Date.now() - HOUR_MS) });

    expect(await pruneOnce(buildPruneCutoff(0))).toBe(1);
    expect(await survivingTokens(user.id)).toEqual([]);
  });
});
