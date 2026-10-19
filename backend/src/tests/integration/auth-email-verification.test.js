/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration Tests: Email Verification Flow
 *
 * Covers POST /api/v1/auth/send-verification-code and
 * POST /api/v1/auth/verify-email-code end-to-end:
 *   - Register user → first verification code written before the response
 *     (only the email goes out in the background)
 *   - Manually issue code → row exists in email_verification_codes
 *   - Verify with correct code → users.email_verified becomes true
 *   - Verify with wrong code → INVALID_CODE + attempts increments
 *   - Verify after 5 wrong attempts → TOO_MANY_ATTEMPTS, code invalidated
 *   - Verify when no active code → INVALID_OR_EXPIRED_CODE
 *   - Already verified → EMAIL_ALREADY_VERIFIED
 *
 * Note: Resend is not configured in test env, so emailService logs a
 * warning and returns sent:false — the DB row is still created and the
 * verification flow can be tested without real email delivery.
 *
 * Rate limiting: register keys by IP — one bucket for every test under
 * supertest; send and verify key by account. beforeEach clears all three, so
 * the dozen registrations of the file and its handful of sends never meet a
 * limit the test is not about.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import redisClient, { connectRedis } from '../../config/redis.js';

const registerUser = async (overrides = {}) => {
  const payload = {
    email: 'verify@test.com',
    password: 'Test123!@#',
    name: 'Verify Tester',
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
  };
};

const getLatestCodeForUser = async (userId) => {
  const result = await query(
    `SELECT id, code, used_at, attempts
     FROM email_verification_codes
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
};

const clearRateLimitKeys = async () => {
  for (const prefix of ['verify-send', 'verify-code', 'register']) {
    const keys = await redisClient.keys(`ratelimit:${prefix}:*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
};

beforeAll(async () => {
  if (!redisClient.isReady) {
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
});

describe('POST /api/v1/auth/register', () => {
  test('writes the verification code before responding', async () => {
    // Warm the pool first. With one open connection the read below waits for
    // a new one, and a write left behind the response would finish meanwhile:
    // this test passed against a controller without the await.
    await Promise.all([query('SELECT 1'), query('SELECT 1'), query('SELECT 1')]);
    const { user } = await registerUser();

    // One read, no waiting: the code must already be there. Until 2026-09-28
    // it was written after the response, and a quick resend could leave two
    // codes active.
    const codeRow = await getLatestCodeForUser(user.id);
    expect(codeRow).not.toBeNull();
    expect(codeRow.code).toMatch(/^\d{6}$/);
    expect(codeRow.used_at).toBeNull();
    expect(codeRow.attempts).toBe(0);
  });
});

describe('POST /api/v1/auth/send-verification-code', () => {
  test('issues code for authenticated email user', async () => {
    const { user, accessToken } = await registerUser();

    const response = await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('expiresAt');
    // sent:false is expected because RESEND_API_KEY is not set in test env;
    // the code row should still exist in DB
    expect(typeof response.body.data.sent).toBe('boolean');

    const codeRow = await getLatestCodeForUser(user.id);
    expect(codeRow).not.toBeNull();
    expect(codeRow.code).toMatch(/^\d{6}$/);
    expect(codeRow.used_at).toBeNull();
    expect(codeRow.attempts).toBe(0);
  });

  test('rejects unauthenticated request with 401', async () => {
    await request(app)
      .post('/api/v1/auth/send-verification-code')
      .expect(401);
  });

  test('returns 409 when email already verified', async () => {
    const { user, accessToken } = await registerUser();
    await query(
      'UPDATE users SET email_verified = true WHERE id = $1',
      [user.id],
    );

    const response = await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);

    expect(response.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  test('issuing new code invalidates previous active code', async () => {
    const { user, accessToken } = await registerUser();

    // First call (also auto-fired during register, but explicit call ensures
    // we can read its row)
    await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const firstCode = await getLatestCodeForUser(user.id);

    // Second call — invalidates first
    await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const previousRow = await query(
      'SELECT used_at FROM email_verification_codes WHERE id = $1',
      [firstCode.id],
    );
    expect(previousRow.rows[0].used_at).not.toBeNull();
  });

  // «The previous active code» — the requester's own: another account's live
  // code survives, and another account's codes do not count toward this
  // one's limit (five codes an hour, the one written at registration included).
  test("a new code and the hourly limit are per account: another account's code survives, its codes do not count here", async () => {
    const send = (token) => request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${token}`);
    const { user: other, accessToken: otherToken } = await registerUser({ email: 'other-verify@test.com' });
    for (let i = 0; i < 4; i += 1) {
      await send(otherToken).expect(200); // the other account is at its five
    }
    const otherCode = await getLatestCodeForUser(other.id);
    const { user, accessToken } = await registerUser();

    for (let i = 0; i < 4; i += 1) {
      await send(accessToken).expect(200);
    }

    const { rows: [otherNow] } = await query(
      'SELECT used_at FROM email_verification_codes WHERE id = $1',
      [otherCode.id],
    );
    expect(otherNow.used_at).toBeNull();
    const { rows: [mine] } = await query(
      'SELECT COUNT(*)::int AS n FROM email_verification_codes WHERE user_id = $1',
      [user.id],
    );
    expect(mine.n).toBe(5);
  });
});

describe('POST /api/v1/auth/verify-email-code', () => {
  test('verifies correct code and sets email_verified=true', async () => {
    const { user, accessToken } = await registerUser();

    // Issue code explicitly so we can read it deterministically
    await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const codeRow = await getLatestCodeForUser(user.id);

    const response = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: codeRow.code })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.emailVerified).toBe(true);

    // Check DB
    const userRow = await query(
      'SELECT email_verified FROM users WHERE id = $1',
      [user.id],
    );
    expect(userRow.rows[0].email_verified).toBe(true);

    // Code should be marked used
    const usedCode = await query(
      'SELECT used_at FROM email_verification_codes WHERE id = $1',
      [codeRow.id],
    );
    expect(usedCode.rows[0].used_at).not.toBeNull();
  });

  test('rejects malformed code with 400', async () => {
    const { accessToken } = await registerUser();

    const response = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: 'abc' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  test('rejects wrong code with 401 INVALID_CODE and increments attempts', async () => {
    const { user, accessToken } = await registerUser();
    await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const codeRow = await getLatestCodeForUser(user.id);
    const wrongCode = codeRow.code === '000000' ? '111111' : '000000';

    const response = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: wrongCode })
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_CODE');

    const updatedRow = await getLatestCodeForUser(user.id);
    expect(updatedRow.attempts).toBe(1);
    expect(updatedRow.used_at).toBeNull();
  });

  test('returns 410 INVALID_OR_EXPIRED_CODE when no active code', async () => {
    const { accessToken } = await registerUser();

    // Registration writes its code before responding (see the register test
    // above), so nothing lands after this DELETE.
    await query('DELETE FROM email_verification_codes');

    const response = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '123456' })
      .expect(410);

    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
  });

  // «Expired» as well as «no active code»: the right code past its expiry is
  // refused too (the expiry is moved back with the database clock, the one the
  // lookup compares against).
  test('returns 410 INVALID_OR_EXPIRED_CODE for the right code past its expiry', async () => {
    const { user, accessToken } = await registerUser();
    const codeRow = await getLatestCodeForUser(user.id);
    await query(
      "UPDATE email_verification_codes SET expires_at = NOW() - interval '1 minute' WHERE id = $1",
      [codeRow.id],
    );

    const response = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: codeRow.code })
      .expect(410);

    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');
  });

  test('invalidates code after 5 wrong attempts (TOO_MANY_ATTEMPTS)', async () => {
    const { user, accessToken } = await registerUser();
    await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const codeRow = await getLatestCodeForUser(user.id);
    const wrongCode = codeRow.code === '000000' ? '111111' : '000000';

    // 5 wrong attempts → all return INVALID_CODE; the 5th invalidates the code
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/v1/auth/verify-email-code')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: wrongCode })
        .expect(401);
    }

    // 6th attempt — code is invalidated → no active code → 410
    const response = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: wrongCode })
      .expect(410);

    expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_CODE');

    // Confirm code was forcibly marked used
    const finalRow = await query(
      'SELECT used_at FROM email_verification_codes WHERE id = $1',
      [codeRow.id],
    );
    expect(finalRow.rows[0].used_at).not.toBeNull();
  });

  test('rejects unauthenticated request with 401', async () => {
    await request(app)
      .post('/api/v1/auth/verify-email-code')
      .send({ code: '123456' })
      .expect(401);
  });
});
