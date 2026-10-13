/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Refresh tokens at rest — integration
 *
 * - every refresh token the API hands out is stored as its hash, never the
 *   token itself: registration, login, rotation, a replay inside the window
 * - what the table holds for a session does not open that session
 * - a session opened before hashing — its row holds the token itself — goes
 *   on working: refresh, the replay of a rotation made just before the
 *   deploy, logout. Nobody is signed out by the change
 * - migration 036 hashes such rows in place, the sessions survive it, and it
 *   refuses to run before the new code has stored a single hash
 *
 * utils/refreshTokenStorage.js explains the stored form; config/auth.js the
 * grace window.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import app from '../../server.js';
import { getClient } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import {
  createTestUser,
  generateTestAccessToken,
  storeRefreshToken,
} from '../utils/auth.js';
import { generateRefreshToken } from '../../utils/jwt.js';
import { storedRefreshToken } from '../../utils/refreshTokenStorage.js';
import { testUsers } from '../fixtures/users.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_036 = join(HERE, '..', '..', '..', 'migrations', '036_hash_refresh_tokens.sql');
const migration036 = () => readFileSync(MIGRATION_036, 'utf8').replace(/\r\n/g, '\n');

const GRACE_ENV = 'REFRESH_REUSE_GRACE_SECONDS';
const originalGrace = process.env[GRACE_ENV];

const register = (user = testUsers.regularUser) =>
  request(app).post('/api/v1/auth/register').send(user).expect(201);

const refresh = (refreshToken) =>
  request(app).post('/api/v1/auth/refresh').send({ refreshToken });

const storedTokens = async (userId) => {
  const { rows } = await query(
    'SELECT id, token, used_at, replaced_by FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows;
};

/**
 * Runs 036 on a connection of its own. A refused run leaves that connection
 * inside an aborted transaction, which must not return to the shared pool.
 */
const applyMigration036 = async () => {
  const client = await getClient();
  try {
    await client.query(migration036());
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** A row as the code before hashing wrote it: the token itself. */
const insertRowAsBeforeHashing = async (userId, token, { usedSecondsAgo = null, replacedBy = null } = {}) => {
  const id = randomUUID();
  await query(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at, used_at, replaced_by)
     VALUES ($1, $2, $3, NOW() + interval '30 days', NOW() - interval '1 hour',
             CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() - make_interval(secs => $4::int) END,
             $5)`,
    [id, userId, token, usedSecondsAgo, replacedBy],
  );
  return id;
};

beforeEach(async () => {
  await clearAllData();
  process.env[GRACE_ENV] = '60';
});

afterAll(async () => {
  await clearAllData();
  if (originalGrace === undefined) {
    delete process.env[GRACE_ENV];
  } else {
    process.env[GRACE_ENV] = originalGrace;
  }
});

describe('refresh tokens are stored as hashes', () => {
  test('registration and login store the token\'s hash, never the token', async () => {
    const registration = await register();
    const userId = registration.body.data.user.id;
    const first = registration.body.data.refreshToken;

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUsers.regularUser.email, password: testUsers.regularUser.password })
      .expect(200);
    const second = login.body.data.refreshToken;

    const rows = await storedTokens(userId);
    expect(rows.map((row) => row.token)).toEqual([
      storedRefreshToken(first),
      storedRefreshToken(second),
    ]);
    rows.forEach((row) => {
      expect(row.token).not.toBe(first);
      expect(row.token).not.toBe(second);
    });
  });

  test('a rotation stores the successor as its hash, and a replay inside the window hands back a working one', async () => {
    const registration = await register();
    const userId = registration.body.data.user.id;

    const rotated = await refresh(registration.body.data.refreshToken).expect(200);
    const successor = rotated.body.data.refreshToken;

    const rows = await storedTokens(userId);
    expect(rows).toHaveLength(2);
    expect(rows[1].token).toBe(storedRefreshToken(successor));
    expect(rows[0].replaced_by).toBe(rows[1].id);

    // The answer was "lost": the client presents the burned token again. It
    // is handed the same successor — computed again, since the database has
    // only its hash — and that successor works.
    const replay = await refresh(registration.body.data.refreshToken).expect(200);
    expect(replay.body.data.refreshToken).toBe(successor);
    await refresh(successor).expect(200);
  });

  test('what the table holds for a session does not open it', async () => {
    const registration = await register();
    const userId = registration.body.data.user.id;
    const [row] = await storedTokens(userId);

    const response = await refresh(row.token).expect(401);
    expect(response.body.error.code).toBe('INVALID_TOKEN');

    // Not a reuse alarm either: the real session is untouched.
    const [after] = await storedTokens(userId);
    expect(after.used_at).toBeNull();
    await refresh(registration.body.data.refreshToken).expect(200);
  });
});

describe('a session opened before hashing', () => {
  test('refreshes, and its successor is stored as a hash', async () => {
    const user = await createTestUser(testUsers.regularUser);
    const oldToken = generateRefreshToken();
    await storeRefreshToken(user.id, oldToken, { asBeforeHashing: true });

    const response = await refresh(oldToken).expect(200);
    const successor = response.body.data.refreshToken;

    const rows = await storedTokens(user.id);
    expect(rows).toHaveLength(2);
    const [old, next] = rows;
    expect(old.token).toBe(oldToken);
    expect(old.used_at).not.toBeNull();
    expect(old.replaced_by).toBe(next.id);
    expect(next.token).toBe(storedRefreshToken(successor));

    await refresh(successor).expect(200);
  });

  test('a rotation made just before the deploy is replayed with the successor its row holds', async () => {
    const user = await createTestUser(testUsers.regularUser);
    // Both rows written by the code before hashing: the predecessor burned two
    // seconds ago, its random successor live. The answer to that rotation was
    // lost in the deploy, and the client replays.
    const oldPredecessor = generateRefreshToken();
    const oldSuccessor = generateRefreshToken();
    const successorId = await insertRowAsBeforeHashing(user.id, oldSuccessor);
    await insertRowAsBeforeHashing(user.id, oldPredecessor, { usedSecondsAgo: 2, replacedBy: successorId });

    const replay = await refresh(oldPredecessor).expect(200);

    expect(replay.body.data.refreshToken).toBe(oldSuccessor);
    await refresh(oldSuccessor).expect(200);
  });

  test('is ended by logout', async () => {
    const user = await createTestUser(testUsers.regularUser);
    const oldToken = generateRefreshToken();
    await storeRefreshToken(user.id, oldToken, { asBeforeHashing: true });

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${generateTestAccessToken(user)}`)
      .send({ refreshToken: oldToken })
      .expect(200);

    const [row] = await storedTokens(user.id);
    expect(row.used_at).not.toBeNull();
    const response = await refresh(oldToken).expect(403);
    expect(response.body.error.code).toBe('TOKEN_REUSE_DETECTED');
  });
});

describe('migration 036', () => {
  test('refuses to run while no token has been stored as a hash yet, and changes nothing', async () => {
    const user = await createTestUser(testUsers.regularUser);
    const oldToken = generateRefreshToken();
    await storeRefreshToken(user.id, oldToken, { asBeforeHashing: true });

    await expect(applyMigration036()).rejects.toThrow(/Миграция 036 остановлена/);

    const [row] = await storedTokens(user.id);
    expect(row.token).toBe(oldToken);
    await refresh(oldToken).expect(200);
  });

  test('hashes every row written before hashing; the sessions survive it', async () => {
    // One session from before the change, one burned row from before it, and
    // one session the new code opened — which is what lets 036 run at all.
    const before = await createTestUser(testUsers.regularUser);
    const liveOld = generateRefreshToken();
    const burnedOld = generateRefreshToken();
    await insertRowAsBeforeHashing(before.id, liveOld);
    await insertRowAsBeforeHashing(before.id, burnedOld, { usedSecondsAgo: 3600 });
    const fresh = await register(testUsers.regularUser2);

    await applyMigration036();

    const { rows } = await query('SELECT token FROM refresh_tokens ORDER BY token');
    expect(rows).toHaveLength(3);
    rows.forEach((row) => expect(row.token).toMatch(/^sha256:[0-9a-f]{64}$/));
    const tokens = rows.map((row) => row.token);
    expect(tokens).toEqual(expect.arrayContaining([
      storedRefreshToken(liveOld),
      storedRefreshToken(burnedOld),
      storedRefreshToken(fresh.body.data.refreshToken),
    ]));

    // The session from before the change is found by hash now and refreshes;
    // the burned row still means what it meant.
    await refresh(liveOld).expect(200);
    await refresh(fresh.body.data.refreshToken).expect(200);
    const reuse = await refresh(burnedOld).expect(403);
    expect(reuse.body.error.code).toBe('TOKEN_REUSE_DETECTED');
  });

  test('a second run finds nothing to hash', async () => {
    const user = await createTestUser(testUsers.regularUser);
    await insertRowAsBeforeHashing(user.id, generateRefreshToken());
    await register(testUsers.regularUser2);

    await applyMigration036();
    const { rows: once } = await query('SELECT id, token FROM refresh_tokens ORDER BY id');
    await applyMigration036();
    const { rows: twice } = await query('SELECT id, token FROM refresh_tokens ORDER BY id');

    expect(twice).toEqual(once);
  });
});
