/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration Tests: Email Verification Flow
 *
 * Covers POST /api/v1/auth/send-verification-code and
 * POST /api/v1/auth/verify-email-code end-to-end:
 *   - Register user → automatic verification code issued (fire-and-forget)
 *   - Manually issue code → row exists in email_verification_codes
 *   - Verify with correct code → users.email_verified becomes true
 *   - Verify with wrong code → INVALID_CODE + attempts increments
 *   - Verify after 5 wrong attempts → TOO_MANY_ATTEMPTS, code invalidated
 *   - Verify when no active code → INVALID_OR_EXPIRED_CODE
 *   - Already verified → EMAIL_ALREADY_VERIFIED
 *
 * Note: SendGrid is not configured in test env, so emailService logs a
 * warning and returns sent:false — the DB row is still created and the
 * verification flow can be tested without real email delivery.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';

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

beforeAll(async () => {
  await clearAllData();
});

beforeEach(async () => {
  await clearAllData();
});

afterAll(async () => {
  await clearAllData();
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
    // sent:false is expected because SENDGRID_API_KEY is not set in test env;
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
    const { user, accessToken } = await registerUser();

    // The register endpoint fires sendEmailVerificationCode() asynchronously
    // (fire-and-forget). Wait briefly for it to complete before wiping codes,
    // otherwise the row may be inserted AFTER our DELETE, causing the next
    // verify request to find an active code.
    for (let i = 0; i < 20; i += 1) {
      const row = await getLatestCodeForUser(user.id);
      if (row) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await query('DELETE FROM email_verification_codes');

    const response = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '123456' })
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
