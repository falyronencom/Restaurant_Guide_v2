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
 *   - forgot: the earlier link retires only once the new letter has gone out;
 *     a letter that did not go out leaves nothing and does not count; the
 *     five hold for requests arriving together; the answer awaits no issue
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
 * The mailer is the one boundary replaced (Resend is not configured in
 * tests): it records what would be mailed, so one test follows the mailed
 * link itself — issue → mail → consume. By default it answers as an
 * unconfigured provider does outside production (the link counts as
 * delivered); `mailAnswer` makes it refuse, accept or hold a letter.
 *
 * Everything after the account lookup runs after the answer
 * (authService.issuePasswordReset): a test reads what a request left behind
 * only after `settleIssues()`.
 *
 * Rate limiting: public endpoints key by IP, which is constant under
 * supertest and the hour-window keys survive across runs — beforeEach clears
 * the relevant ratelimit:* keys so tests stay deterministic within the hour.
 * Registration (20 a minute per IP) is among them: the file registers a dozen
 * accounts, and a suite run right before it shares the same minute.
 */

import { jest } from '@jest/globals';
import { createHash, randomBytes } from 'crypto';

/** What the service handed to the mailer, in order. */
const mailed = [];
const NOT_CONFIGURED = () => ({ sent: false, reason: 'RESEND_NOT_CONFIGURED' });
const REFUSED = () => ({ sent: false, reason: 'RESEND_ERROR' });
const ACCEPTED = () => ({ sent: true });
/** How the mailer answers a letter (a value, or a promise of one). */
let mailAnswer = NOT_CONFIGURED;
// Plain functions, not jest.fn: resetMocks would wipe them before every test.
jest.unstable_mockModule('../../services/emailService.js', () => ({
  CODE_PROMPT: '',
  sendVerificationCodeEmail: async () => ({ sent: false, reason: 'RESEND_NOT_CONFIGURED' }),
  sendPasswordResetEmail: async (toEmail, rawToken, _userName, context) => {
    mailed.push({ toEmail, rawToken, context });
    return mailAnswer({ toEmail, rawToken });
  },
  _resetForTests: () => {},
}));

const request = (await import('supertest')).default;
const { default: app } = await import('../../server.js');
const { clearAllData, query } = await import('../utils/database.js');
const { default: redisClient, connectRedis } = await import('../../config/redis.js');
const {
  createPasswordResetToken,
  _settlePasswordResetIssuesForTests: settleIssues,
} = await import('../../services/authService.js');
const { getClient } = await import('../../config/database.js');

const GENERIC_FORGOT_MESSAGE = 'If this email is registered, a password reset link has been sent';

/** «Forgot password» over HTTP, then wait for the issue it started. */
const forgot = async (email) => {
  const response = await request(app)
    .post('/api/v1/auth/forgot-password')
    .send({ email })
    .expect(200);
  await settleIssues();
  return response;
};

/** A promise the test resolves by hand. */
const parked = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};

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
  const prefixes = ['forgot-password', 'reset-password', 'login', 'register'];
  for (const prefix of prefixes) {
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
  await settleIssues();
  await clearAllData();
  await clearRateLimitKeys();
  mailed.length = 0;
  mailAnswer = NOT_CONFIGURED;
});

afterAll(async () => {
  await settleIssues();
  await clearAllData();
  await clearRateLimitKeys();
});

describe('POST /api/v1/auth/forgot-password', () => {
  test('answers byte-identical generic 200 for existing and unknown email', async () => {
    const { user } = await registerUser();

    const existing = await forgot(user.email);
    const unknown = await forgot('ghost@test.com');

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

    await forgot(user.email);

    const [row] = await getTokenRowsForUser(user.id);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.used_at).toBeNull();

    // Service computes expiry on the Node clock; node-postgres parses the
    // naive timestamp back as local time, so this comparison is TZ-stable
    const ttlMs = new Date(row.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(25 * 60 * 1000);
    expect(ttlMs).toBeLessThan(35 * 60 * 1000);
  });

  // The header's «raw token never persisted» and the link that works, held
  // together: a raw token is 64 hex too, so the stored shape alone cannot tell
  // a hash from the token itself. The mailed token is the user's only copy.
  test('the mailed token is what opens the reset; the database holds only its hash', async () => {
    const { user } = await registerUser();

    await forgot(user.email);

    expect(mailed).toHaveLength(1);
    const { toEmail, rawToken, context } = mailed[0];
    expect(toEmail).toBe(user.email);
    // The account rides along: a letter that does not go out is logged with
    // it, in the background — the answer and its timing do not change (Н33).
    expect(context).toEqual({ userId: user.id });
    const [row] = await getTokenRowsForUser(user.id);
    expect(row.token_hash).toBe(sha256Hex(rawToken));
    expect(row.token_hash).not.toBe(rawToken);

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'MailedLink123' })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'MailedLink123' })
      .expect(200);
  });

  test('re-request invalidates the previous active token', async () => {
    const { user } = await registerUser();

    await forgot(user.email);
    await forgot(user.email);

    const rows = await getTokenRowsForUser(user.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].used_at).not.toBeNull(); // first burned
    expect(rows[1].used_at).toBeNull(); // only latest link works
  });

  // «The previous token» — the requester's own: another account's live link
  // survives a re-request, and another account's requests do not count
  // toward this one's hourly throttle.
  test("re-request and the throttle are per account: another account's link survives, its requests do not count here", async () => {
    const { user: other } = await registerUser({ email: 'other-reset@test.com' });
    const { user } = await registerUser();
    await forgot(other.email);

    for (let i = 0; i < 5; i += 1) {
      await forgot(user.email);
    }

    const otherRows = await getTokenRowsForUser(other.id);
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0].used_at).toBeNull(); // not burned by the other account's re-requests
    expect(await getTokenRowsForUser(user.id)).toHaveLength(5); // the other's request was not counted here
  });

  test('per-user throttle: 6th request within an hour issues no token but still answers 200', async () => {
    const { user } = await registerUser();

    for (let i = 0; i < 5; i += 1) {
      await forgot(user.email);
    }

    const response = await forgot(user.email);

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

// Н46: until 25.10 the earlier links were retired before the new letter was
// handed over — when it did not go out, the person held no working link, and
// the attempt used up one of the hour's five. Н45: requests arriving together
// all read the same count.
describe('«forgot password» — which links work, and the hourly five', () => {
  const resetWith = (token) => request(app)
    .post('/api/v1/auth/reset-password')
    .send({ token, password: 'Fresh9New!pass' });

  /** Wait (bounded) until the background work has got as far as `condition`. */
  const until = async (condition) => {
    for (let i = 0; i < 300 && !condition(); i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(condition()).toBe(true);
  };

  test('a letter that did not go out: the earlier link keeps working, the new one leaves no trace', async () => {
    const { user } = await registerUser();
    const earlier = await seedResetToken(user.id);
    mailAnswer = REFUSED;

    await forgot(user.email);

    expect(mailed).toHaveLength(1);
    const rows = await getTokenRowsForUser(user.id);
    expect(rows).toEqual([expect.objectContaining({ token_hash: sha256Hex(earlier), used_at: null })]);
    await resetWith(mailed[0].rawToken).expect(410);
    await resetWith(earlier).expect(200);
  });

  test('letters that did not go out do not use up the hour: once mail is back, the link comes', async () => {
    const { user } = await registerUser();
    mailAnswer = REFUSED;
    for (let i = 0; i < 5; i += 1) {
      await forgot(user.email);
    }
    expect(await getTokenRowsForUser(user.id)).toHaveLength(0);

    mailAnswer = ACCEPTED;
    await forgot(user.email);

    expect(mailed).toHaveLength(6);
    await resetWith(mailed[5].rawToken).expect(200);
  });

  test('a letter that went out retires the earlier link; the mailed one works', async () => {
    const { user } = await registerUser();
    const earlier = await seedResetToken(user.id);
    mailAnswer = ACCEPTED;

    await forgot(user.email);

    await resetWith(earlier).expect(410);
    await resetWith(mailed[0].rawToken).expect(200);
  });

  // The link in a letter must work from the moment the letter can be opened:
  // the new token is stored before the letter is handed over, next to the
  // earlier ones, which retire only once it has gone out.
  test('while the letter is on the way, the earlier link and the new one both work', async () => {
    const { user } = await registerUser();
    const earlier = await seedResetToken(user.id);
    const letter = parked();
    mailAnswer = () => letter.promise;

    // Released whatever happens: a letter left on the way would hold every
    // later test at settleIssues().
    try {
      await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).timeout(3000).expect(200);
      await until(() => mailed.length === 1);

      const onTheWay = await getTokenRowsForUser(user.id);
      expect(onTheWay.map((row) => [row.token_hash, row.used_at])).toEqual([
        [sha256Hex(earlier), null],
        [sha256Hex(mailed[0].rawToken), null],
      ]);
    } finally {
      letter.release({ sent: true });
    }
    await settleIssues();
    const [earlierRow, newRow] = await getTokenRowsForUser(user.id);
    expect(earlierRow.used_at).not.toBeNull();
    expect(newRow.used_at).toBeNull();
  });

  // The answer and its moment do not depend on whether the address is known:
  // nothing the account decides — its limit, its token — is awaited. Held
  // here at the account's lock, the issue cannot finish, and the answer comes.
  test('a known address is answered without waiting for its link to be issued', async () => {
    const { user } = await registerUser();
    const holder = await getClient();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`password_reset_tokens:${user.id}`]);

      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: user.email })
        .timeout(3000)
        .expect(200);

      expect(response.body.data.message).toBe(GENERIC_FORGOT_MESSAGE);
      expect(await getTokenRowsForUser(user.id)).toHaveLength(0);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    await settleIssues();
    expect(await getTokenRowsForUser(user.id)).toHaveLength(1);
  });

  // Called below HTTP: supertest requests reach the database one after
  // another and would not race (feedback: supertest does not reproduce a race).
  test('requests arriving together do not get past the hourly five', async () => {
    const { user } = await registerUser();
    for (let i = 0; i < 4; i += 1) {
      await seedResetToken(user.id);
    }

    await Promise.all([1, 2, 3].map(() => createPasswordResetToken(user.email)));
    await settleIssues();

    expect(await getTokenRowsForUser(user.id)).toHaveLength(5);
    expect(mailed).toHaveLength(1);
  });

  // The later-issued letter goes out first, the earlier-issued one after it:
  // the later-issued link is the one that works — the two never retire each other.
  test('two letters going out in the reverse order: the later-issued link works, every earlier one does not', async () => {
    const { user } = await registerUser();
    const earlier = await seedResetToken(user.id);
    const letters = new Map(); // raw token → its letter, held until released
    mailAnswer = ({ rawToken }) => {
      const letter = parked();
      letters.set(rawToken, letter);
      return letter.promise;
    };
    const isRetired = async (tokenHash) => (await getTokenRowsForUser(user.id))
      .find((row) => row.token_hash === tokenHash).used_at !== null;

    let older;
    let later;
    try {
      await Promise.all([createPasswordResetToken(user.email), createPasswordResetToken(user.email)]);
      await until(() => letters.size === 2);
      [, older, later] = await getTokenRowsForUser(user.id);
      const letterOf = (row) => [...letters].find(([raw]) => sha256Hex(raw) === row.token_hash)[1];

      letterOf(later).release({ sent: true });
      for (let i = 0; i < 300 && !(await isRetired(older.token_hash)); i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 10); });
      }
      expect(await isRetired(older.token_hash)).toBe(true); // the later letter went out first
      letterOf(older).release({ sent: true });
    } finally {
      letters.forEach((letter) => letter.release({ sent: true }));
    }
    await settleIssues();

    const [seeded, olderNow, laterNow] = await getTokenRowsForUser(user.id);
    expect(seeded.token_hash).toBe(sha256Hex(earlier));
    expect(seeded.used_at).not.toBeNull();
    expect(olderNow.used_at).not.toBeNull();
    expect(laterNow.used_at).toBeNull();
    const laterLink = [...letters.keys()].find((raw) => sha256Hex(raw) === later.token_hash);
    await resetWith(laterLink).expect(200);
  });

  // A provider that did not answer in time may still deliver the letter: its
  // link must work when it arrives, and the earlier one stays too.
  test('a letter whose outcome is unknown: the new link and the earlier one both keep working', async () => {
    const { user } = await registerUser();
    const earlier = await seedResetToken(user.id);
    mailAnswer = () => ({ sent: false, reason: 'RESEND_TIMEOUT' });

    await forgot(user.email);

    const rows = await getTokenRowsForUser(user.id);
    expect(rows.map((row) => [row.token_hash, row.used_at])).toEqual([
      [sha256Hex(earlier), null],
      [sha256Hex(mailed[0].rawToken), null],
    ]);
    await resetWith(mailed[0].rawToken).expect(200);
  });
});

// Several links can be alive at once — while a newer letter is on the way, or
// after a letter whose outcome is unknown. The password they would set is set
// by the first one used.
test('a completed reset retires the account\'s other live links', async () => {
  const { user } = await registerUser();
  const first = await seedResetToken(user.id);
  const second = await seedResetToken(user.id);

  await request(app)
    .post('/api/v1/auth/reset-password')
    .send({ token: second, password: 'Fresh9New!pass' })
    .expect(200);

  const replay = await request(app)
    .post('/api/v1/auth/reset-password')
    .send({ token: first, password: 'Other9New!pass' })
    .expect(410);
  expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
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
    // It was created before the reset ended the account's sessions, so it is
    // refused as revoked — 401 TOKEN_REVOKED — and not as a replay: until
    // migration 035 it took the reuse-detection path (403), which revoked every
    // session once more, the one opened after the reset included
    // (session-revocation.test.js).
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_REVOKED');

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

  // Register-grade: each of the register rules on its own — a password that
  // breaks all of them at once ('weak') would be refused with any one left.
  test.each([
    ['weak', 'every rule at once'],
    ['Short1a', 'shorter than 8'],
    ['nouppercase1', 'no uppercase letter'],
    ['NOLOWERCASE1', 'no lowercase letter'],
    ['NoDigitsHere', 'no digit'],
  ])('enforces register-grade password complexity with 422: %s (%s)', async (password) => {
    const { user } = await registerUser();
    const rawToken = await seedResetToken(user.id);

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password })
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
