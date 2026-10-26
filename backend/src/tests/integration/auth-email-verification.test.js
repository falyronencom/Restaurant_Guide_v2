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
 * warning and returns sent:false — outside production that is the dev mail
 * channel: the DB row is still created and the verification flow can be
 * tested without real email delivery.
 *
 * The resend cases about a mail provider that answers, refuses or keeps
 * silent configure one: the Resend SDK is the one boundary replaced, by a
 * stand-in whose answer each such test sets (`provider`).
 *
 * Rate limiting: register keys by IP — one bucket for every test under
 * supertest; send and verify key by account. beforeEach clears all three, so
 * the dozen registrations of the file and its handful of sends never meet a
 * limit the test is not about.
 */

import { jest } from '@jest/globals';

/** What the stand-in provider was handed, in order; and how it answers. */
const mails = [];
let provider = () => ({ data: { id: 'msg-1' }, error: null });
// A plain class, not jest.fn: resetMocks would wipe it before every test.
jest.unstable_mockModule('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = {
        send: async (msg, options) => {
          mails.push(msg);
          return provider(msg, options);
        },
      };
    }
  },
}));

const request = (await import('supertest')).default;
const { default: app } = await import('../../server.js');
const { clearAllData, query } = await import('../utils/database.js');
const { default: redisClient, connectRedis } = await import('../../config/redis.js');
const { _resetForTests: resetMailClient } = await import('../../services/emailService.js');
const { sendEmailVerificationCode } = await import('../../services/authService.js');

const ACCEPTED = () => ({ data: { id: 'msg-1' }, error: null });
const REFUSED = () => ({ data: null, error: { name: 'application_error', message: 'Service unavailable' } });
const SILENT = () => new Promise(() => {});

/** Turn the mail provider on, answering as `answer` does. */
const configureProvider = (answer) => {
  process.env.RESEND_API_KEY = 're_test_key';
  resetMailClient();
  provider = answer;
};

const codeInMail = (msg) => msg.text.match(/\b(\d{6})\b/)[1];

/** A promise the test resolves by hand. */
const parked = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};

/** Wait (bounded) until the work in flight has got as far as `condition`. */
const until = async (condition) => {
  for (let i = 0; i < 300 && !condition(); i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  expect(condition()).toBe(true);
};

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

const originalResendKey = process.env.RESEND_API_KEY;
const originalSendTimeout = process.env.EMAIL_SEND_TIMEOUT_MS;

beforeEach(async () => {
  await clearAllData();
  await clearRateLimitKeys();
  // No mail provider unless a test configures one.
  process.env.RESEND_API_KEY = '';
  resetMailClient();
  mails.length = 0;
});

afterAll(async () => {
  await clearAllData();
  if (originalResendKey === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = originalResendKey;
  }
  if (originalSendTimeout === undefined) {
    delete process.env.EMAIL_SEND_TIMEOUT_MS;
  } else {
    process.env.EMAIL_SEND_TIMEOUT_MS = originalSendTimeout;
  }
  resetMailClient();
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

  // Until 24.10 this test pinned the old order — the previous code retired
  // before the send, whatever the send's outcome (it ran with sent:false).
  // Now a code replaces the earlier ones once its email has gone out.
  test('a resent code whose email went out replaces the previous one', async () => {
    const { user, accessToken } = await registerUser();
    const firstCode = await getLatestCodeForUser(user.id);
    configureProvider(ACCEPTED);

    const response = await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.sent).toBe(true);
    const previousRow = await query(
      'SELECT used_at FROM email_verification_codes WHERE id = $1',
      [firstCode.id],
    );
    expect(previousRow.rows[0].used_at).not.toBeNull();
    const latest = await getLatestCodeForUser(user.id);
    expect(latest.code).toBe(codeInMail(mails[0]));
    expect(latest.used_at).toBeNull();
  });

  // Н31: the person found the first letter in spam, pressed «send again», and
  // the provider refused — the code they hold must still work.
  test('when the provider refuses a resend, the previous code keeps working and the unsent one does not', async () => {
    const { user, accessToken } = await registerUser();
    const firstCode = await getLatestCodeForUser(user.id);
    configureProvider(REFUSED);

    const response = await request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // The envelope the clients read (PR #126) is unchanged.
    expect(response.body.success).toBe(true);
    expect(response.body.data.sent).toBe(false);
    expect(response.body.data).toHaveProperty('expiresAt');
    const { rows } = await query(
      'SELECT id, used_at FROM email_verification_codes WHERE user_id = $1',
      [user.id],
    );
    expect(rows).toEqual([{ id: firstCode.id, used_at: null }]);

    // The code in the letter that did not go out is not accepted…
    const unsentCode = codeInMail(mails[0]);
    if (unsentCode !== firstCode.code) {
      const refusedAttempt = await request(app)
        .post('/api/v1/auth/verify-email-code')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: unsentCode })
        .expect(401);
      expect(refusedAttempt.body.error.code).toBe('INVALID_CODE');
    }

    // …and the first one is.
    const verified = await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: firstCode.code })
      .expect(200);
    expect(verified.body.data.user.emailVerified).toBe(true);
  });

  // Н35: a provider that does not answer is a refusal after the bound — the
  // request does not hang until the client drops it.
  test('when the provider does not answer in time, the resend answers sent:false and the previous code keeps working', async () => {
    const { user, accessToken } = await registerUser();
    const firstCode = await getLatestCodeForUser(user.id);
    process.env.EMAIL_SEND_TIMEOUT_MS = '200';
    configureProvider(SILENT);

    try {
      const response = await request(app)
        .post('/api/v1/auth/send-verification-code')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body.data.sent).toBe(false);
    } finally {
      delete process.env.EMAIL_SEND_TIMEOUT_MS;
    }

    const { rows } = await query(
      'SELECT id, used_at FROM email_verification_codes WHERE user_id = $1',
      [user.id],
    );
    expect(rows).toEqual([{ id: firstCode.id, used_at: null }]);
    await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: firstCode.code })
      .expect(200);
  }, 5000);

  // Н32: resends refused by the provider do not use up the hour's five — once
  // mail is back, the person gets their code.
  test('resends whose email did not go out do not count toward the hourly limit', async () => {
    const { accessToken } = await registerUser(); // its code is one of the five
    const send = () => request(app)
      .post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${accessToken}`);
    configureProvider(REFUSED);

    for (let i = 0; i < 5; i += 1) {
      const refused = await send().expect(200);
      expect(refused.body.data.sent).toBe(false);
    }

    provider = ACCEPTED;
    const delivered = await send().expect(200);
    expect(delivered.body.data.sent).toBe(true);
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

  // Н45: until 25.10 the count was read before the send and the code written
  // after it — resends in flight together all read the same count. Called
  // below HTTP: supertest requests reach the database one after another and
  // would not race.
  test('resends pressed together do not get past the hourly five', async () => {
    const { user } = await registerUser(); // its code is one of the five
    configureProvider(ACCEPTED);
    for (let i = 0; i < 3; i += 1) {
      await expect(sendEmailVerificationCode(user.id)).resolves.toMatchObject({ sent: true });
    }
    provider = () => new Promise((resolve) => { setTimeout(() => resolve(ACCEPTED()), 100); });

    const outcomes = await Promise.allSettled([1, 2, 3].map(() => sendEmailVerificationCode(user.id)));

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected').map(({ reason }) => reason.message))
      .toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    const { rows: [mine] } = await query(
      'SELECT COUNT(*)::int AS n FROM email_verification_codes WHERE user_id = $1',
      [user.id],
    );
    expect(mine.n).toBe(5);
    expect(mails).toHaveLength(4);
  });

  // The resend's code is counted while its letter is on the way, but the code
  // the person already holds stays theirs until the letter has gone out.
  test("while a resend's letter is on the way, the code the person holds still works", async () => {
    const { user, accessToken } = await registerUser();
    const firstCode = await getLatestCodeForUser(user.id);
    const letter = parked();
    configureProvider(() => letter.promise);

    const resend = sendEmailVerificationCode(user.id);
    try {
      await until(() => mails.length === 1);

      await request(app)
        .post('/api/v1/auth/verify-email-code')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: firstCode.code })
        .expect(200);
    } finally {
      letter.release(ACCEPTED()); // a resend left in flight would outlive the test
    }
    await expect(resend).resolves.toMatchObject({ sent: true });
  });

  // The person pressed «send again» while the first letter was still going:
  // each press gets the ordinary answer, and the code that works is the one
  // in the letter that went out last — the one they will find on top.
  test('two resends pressed together: both answered, one code works — from the letter that went out last', async () => {
    const { user, accessToken } = await registerUser();
    const firstLetter = parked();
    configureProvider(() => (mails.length === 1 ? firstLetter.promise : ACCEPTED()));
    const finished = [];

    const both = Promise.all([1, 2].map(() => sendEmailVerificationCode(user.id).then((outcome) => {
      finished.push(outcome);
      return outcome;
    })));
    try {
      await until(() => finished.length === 1); // the second letter went out, its code is active
    } finally {
      firstLetter.release(ACCEPTED());
    }
    const outcomes = await both;

    expect(outcomes.map(({ sent }) => sent)).toEqual([true, true]);
    const { rows: active } = await query(
      'SELECT code FROM email_verification_codes WHERE user_id = $1 AND used_at IS NULL',
      [user.id],
    );
    expect(active).toEqual([{ code: codeInMail(mails[0]) }]);
    await request(app)
      .post('/api/v1/auth/verify-email-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: codeInMail(mails[0]) })
      .expect(200);
  });

  // Both letters go out at the same moment: the two codes are activated one
  // after the other, and one code stays active, not two.
  test('two resends whose letters go out at the same moment leave one active code', async () => {
    const { user } = await registerUser();
    const letters = parked();
    configureProvider(() => letters.promise);

    const both = Promise.all([1, 2].map(() => sendEmailVerificationCode(user.id)));
    try {
      await until(() => mails.length === 2);
    } finally {
      letters.release(ACCEPTED());
    }
    await both;

    const { rows: active } = await query(
      'SELECT code FROM email_verification_codes WHERE user_id = $1 AND used_at IS NULL',
      [user.id],
    );
    expect(active).toHaveLength(1);
    expect(mails.map(codeInMail)).toContain(active[0].code);
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
