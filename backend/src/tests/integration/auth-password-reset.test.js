/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration Tests: Password Reset Flow
 *
 * Covers POST /api/v1/auth/forgot-password and POST /api/v1/auth/reset-password
 * end-to-end (migration 032, passwordResetModel, authService, authController):
 *   - forgot: enumeration safety — byte-identical 200 for existing and unknown email
 *   - forgot: stores SHA-256 hash only (raw token never persisted), sane TTL
 *   - forgot: re-request invalidates the previous active token
 *   - forgot: per-user issue throttle (5/hour) still answers generic 200
 *   - forgot: per-IP rate limit → 429 RATE_LIMIT_EXCEEDED
 *   - reset: valid token changes password (old login dies, new login works),
 *     token is single-use, all refresh tokens revoked (force re-login)
 *   - reset: expired / unknown token → 410 INVALID_OR_EXPIRED_TOKEN
 *   - reset: register-grade password complexity enforced (422)
 *
 * Raw-token handling: the service emails the raw token and stores only its
 * hash, so tests that need a known raw token seed rows directly with
 * SHA-256(raw) — same shape the model writes. Seeded expiry timestamps use
 * DB-side NOW() ± interval so comparisons against CURRENT_TIMESTAMP are
 * timezone-proof (local dev: Node UTC+3 vs container UTC).
 *
 * Rate limiting: public endpoints key by IP, which is constant under
 * supertest and the hour-window keys survive across runs — beforeEach clears
 * the relevant ratelimit:* keys so tests stay deterministic within the hour.
 */

import request from 'supertest';
import { createHash, randomBytes } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import redisClient, { connectRedis } from '../../config/redis.js';

const GENERIC_FORGOT_MESSAGE = 'If this email is registered, a password reset link has been sent';

const registerUser = async (overrides = {}) => {
  const payload = {
    email: 'reset@test.com',
    password: 'OldPass123',
    name: 'Reset Tester',
    authMethod: 'email',
    ...overrides,
  };
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send(payload)
    .expect(201);
  return {
    user: response.body.data.user,
    accessToken: response.body.data.accessToken,
    refreshToken: response.body.data.refreshToken,
    password: payload.password,
  };
};

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

/**
 * Seed a reset token row directly (the service never exposes the raw token —
 * it lives only in the email). expires via DB clock to avoid TZ skew.
 */
const seedResetToken = async (userId, { expired = false } = {}) => {
  const rawToken = randomBytes(32).toString('hex');
  const interval = expired ? "NOW() - interval '1 minute'" : "NOW() + interval '30 minutes'";
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, ${interval})`,
    [userId, sha256Hex(rawToken)],
  );
  return rawToken;
};

const getTokenRowsForUser = async (userId) => {
  const result = await query(
    `SELECT id, token_hash, expires_at, used_at
     FROM password_reset_tokens
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows;
};

/** Public endpoints key rate limits by IP — constant in tests, so clear
 *  between tests (and runs within the same hour window). */
const clearRateLimitKeys = async () => {
  const prefixes = ['forgot-password', 'reset-password', 'login'];
  for (const prefix of prefixes) {
    const keys = await redisClient.keys(`ratelimit:${prefix}:*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
};

beforeAll(async () => {
  if (!redisClient.isOpen) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required for rate limit tests');
    }
  }
  await clearAllData();
});

beforeEach(async () => {
  await clearAllData();
  await clearRateLimitKeys();
});

afterAll(async () => {
  await clearAllData();
  await clearRateLimitKeys();
});

describe('POST /api/v1/auth/forgot-password', () => {
  test('answers byte-identical generic 200 for existing and unknown email', async () => {
    const { user } = await registerUser();

    const existing = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@test.com' })
      .expect(200);

    // Enumeration safety: the two response bodies must be indistinguishable
    expect(existing.body).toEqual(unknown.body);
    expect(existing.body.success).toBe(true);
    expect(existing.body.data.message).toBe(GENERIC_FORGOT_MESSAGE);

    // Yet only the real account got a token
    const rows = await getTokenRowsForUser(user.id);
    expect(rows).toHaveLength(1);
    const total = await query('SELECT COUNT(*)::int AS count FROM password_reset_tokens');
    expect(total.rows[0].count).toBe(1);
  });

  test('stores only a SHA-256 hash with a ~30 minute TTL', async () => {
    const { user } = await registerUser();

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    const [row] = await getTokenRowsForUser(user.id);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.used_at).toBeNull();

    // Service computes expiry on the Node clock; node-postgres parses the
    // naive timestamp back as local time, so this comparison is TZ-stable
    const ttlMs = new Date(row.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(25 * 60 * 1000);
    expect(ttlMs).toBeLessThan(35 * 60 * 1000);
  });

  test('re-request invalidates the previous active token', async () => {
    const { user } = await registerUser();

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    const rows = await getTokenRowsForUser(user.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].used_at).not.toBeNull(); // first burned
    expect(rows[1].used_at).toBeNull(); // only latest link works
  });

  test('per-user throttle: 6th request within an hour issues no token but still answers 200', async () => {
    const { user } = await registerUser();

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: user.email })
        .expect(200);
    }

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    // Same generic answer — throttling must not be observable either
    expect(response.body.data.message).toBe(GENERIC_FORGOT_MESSAGE);

    const rows = await getTokenRowsForUser(user.id);
    expect(rows).toHaveLength(5);
  });

  test('rejects malformed email with 422 VALIDATION_ERROR', async () => {
    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toHaveProperty('email');
  });

  test('enforces per-IP rate limit: 11th request in the window → 429', async () => {
    // Unknown email keeps each request cheap; the limiter counts them all
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: `nobody${i}@test.com` })
        .expect(200);
    }

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody-final@test.com' })
      .expect(429);

    expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  test('valid token resets the password and is single-use', async () => {
    const { user, password: oldPassword } = await registerUser();
    const rawToken = await seedResetToken(user.id);
    const newPassword = 'NewPass456';

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: newPassword })
      .expect(200);
    expect(response.body.success).toBe(true);

    // Old password no longer works
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: oldPassword })
      .expect(401);

    // New password does
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword })
      .expect(200);
    expect(login.body.data.user.id).toBe(user.id);

    // Token burned in DB…
    const [row] = await getTokenRowsForUser(user.id);
    expect(row.used_at).not.toBeNull();

    // …and unusable a second time (single-use)
    const replay = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'AnotherPass789' })
      .expect(410);
    expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  test('revokes all refresh tokens — old session cannot refresh after reset', async () => {
    const { user, refreshToken } = await registerUser();
    const rawToken = await seedResetToken(user.id);

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'NewPass456' })
      .expect(200);

    // The pre-reset session's refresh token must be dead (force re-login).
    // Revocation sets used_at, so presenting the token again lands on the
    // reuse-detection path: 403 TOKEN_REUSE_DETECTED (authController.refresh).
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // DB agrees: no live refresh tokens remain for the user
    const live = await query(
      'SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE user_id = $1 AND used_at IS NULL',
      [user.id],
    );
    expect(live.rows[0].count).toBe(0);
  });

  test('expired token → 410 INVALID_OR_EXPIRED_TOKEN', async () => {
    const { user, password } = await registerUser();
    const rawToken = await seedResetToken(user.id, { expired: true });

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'NewPass456' })
      .expect(410);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    // Password unchanged
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password })
      .expect(200);
  });

  test('unknown token → 410 INVALID_OR_EXPIRED_TOKEN', async () => {
    await registerUser();

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: randomBytes(32).toString('hex'), password: 'NewPass456' })
      .expect(410);
    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  test('enforces register-grade password complexity with 422', async () => {
    const { user } = await registerUser();
    const rawToken = await seedResetToken(user.id);

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'weak' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toHaveProperty('password');

    // Validation failed before the service ran — token must survive
    const [row] = await getTokenRowsForUser(user.id);
    expect(row.used_at).toBeNull();
  });

  test('missing token → 422 VALIDATION_ERROR', async () => {
    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ password: 'NewPass456' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toHaveProperty('token');
  });
});
