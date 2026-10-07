/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: POST /api/v1/auth/oauth
 *
 * Drives the real controller → authService → pg-test chain with ONLY the
 * external provider boundary mocked: google-auth-library for Google, and the
 * global fetch to login.yandex.ru for Yandex. Verifies the provider whitelist,
 * provider branching, the new-user / existing-user / account-link paths against
 * the real schema, and the error-code → HTTP-status map. Additive coverage of a
 * path that previously had none (Discovery Q8). The last block covers what an
 * account created here meets at the password login (POST /auth/login and the
 * admin panel's login): it has no password until «forgot password» sets one.
 *
 * google-auth-library is mocked via unstable_mockModule, so app (which imports
 * it transitively through oauthService) is dynamically imported AFTER the mock.
 */
import { jest } from '@jest/globals';
import { createHash, randomBytes } from 'crypto';

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

const request = (await import('supertest')).default;
const app = (await import('../../server.js')).default;
const { clearAllData, query } = await import('../utils/database.js');
const { getUserByEmail, createTestUser } = await import('../utils/auth.js');
const { oauthProviderResponses } = await import('../fixtures/users.js');

const DUMMY_TOKEN = 'oauth-token-1234567890'; // satisfies the validator length (10–5000)

const yandexBody = (overrides = {}) => ({ ...oauthProviderResponses.yandex, ...overrides });

/** Point the in-process global fetch at a canned login.yandex.ru/info response. */
function mockYandexInfo(body, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({ ok, status, json: async () => body });
}

const postOAuth = (payload) =>
  request(app).post('/api/v1/auth/oauth').send(payload);

/**
 * Seed a password-reset token row directly: the service emails the raw token
 * and stores only its SHA-256, so a test that needs a working link writes the
 * row itself (the same way auth-password-reset.test.js does).
 */
async function seedResetToken(userId) {
  const rawToken = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '30 minutes')`,
    [userId, createHash('sha256').update(rawToken).digest('hex')],
  );
  return rawToken;
}

let savedFetch;

beforeAll(() => {
  savedFetch = global.fetch;
});

beforeEach(async () => {
  await clearAllData();
  // resetMocks:true wipes the factory impl each test (feedback_jest_resetmocks).
  MockOAuth2Client.mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken }));
});

afterAll(async () => {
  global.fetch = savedFetch;
  await clearAllData();
});

describe('POST /api/v1/auth/oauth — provider whitelist', () => {
  // Validation failures are 422 (express-validator handleValidationErrors),
  // distinct from the controller's OAuth error map (400/401/403/409).
  test('rejects an unknown provider with a validation error', async () => {
    const res = await postOAuth({ provider: 'facebook', token: DUMMY_TOKEN }).expect(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects a missing token', async () => {
    const res = await postOAuth({ provider: 'yandex' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/oauth — Yandex', () => {
  test('creates a new user on first login (password_hash NULL) and returns a token pair', async () => {
    mockYandexInfo(yandexBody());

    const res = await postOAuth({ provider: 'yandex', token: DUMMY_TOKEN }).expect(200);

    expect(res.body.data.user.email).toBe('yandex-user@yandex.ru');
    expect(res.body.data.user.authMethod).toBe('yandex');
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.tokenType).toBe('Bearer');

    const inDb = await getUserByEmail('yandex-user@yandex.ru');
    expect(inDb.oauth_provider_id).toBe(String(oauthProviderResponses.yandex.id));
    expect(inDb.password_hash).toBeNull();
  });

  test('logs the same user in on a second login (no duplicate row)', async () => {
    mockYandexInfo(yandexBody());
    const first = await postOAuth({ provider: 'yandex', token: DUMMY_TOKEN }).expect(200);

    mockYandexInfo(yandexBody());
    const second = await postOAuth({ provider: 'yandex', token: DUMMY_TOKEN }).expect(200);

    expect(second.body.data.user.id).toBe(first.body.data.user.id);
  });

  test('links onto an existing password account with the same (verified) email', async () => {
    await createTestUser({
      email: 'shared@yandex.ru',
      phone: '+375291112233',
      password: 'Test123!@#',
      name: 'Shared',
      authMethod: 'email',
    });

    mockYandexInfo(yandexBody({ default_email: 'shared@yandex.ru' }));
    const res = await postOAuth({ provider: 'yandex', token: DUMMY_TOKEN }).expect(200);

    expect(res.body.data.user.email).toBe('shared@yandex.ru');
    const inDb = await getUserByEmail('shared@yandex.ru');
    expect(inDb.auth_method).toBe('yandex'); // auth_method flipped on link
  });

  test('maps a non-ok Yandex response to 401 INVALID_TOKEN', async () => {
    mockYandexInfo({}, false, 401);
    const res = await postOAuth({ provider: 'yandex', token: DUMMY_TOKEN }).expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  test('maps a Yandex account without an email to 400 OAUTH_NO_EMAIL', async () => {
    mockYandexInfo({ id: 5 }); // no default_email
    const res = await postOAuth({ provider: 'yandex', token: DUMMY_TOKEN }).expect(400);
    expect(res.body.error.code).toBe('OAUTH_NO_EMAIL');
  });
});

describe('POST /api/v1/auth/oauth — Google', () => {
  test('creates a new Google user (id_token verified via the mocked library)', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => oauthProviderResponses.google,
    });

    const res = await postOAuth({ provider: 'google', token: DUMMY_TOKEN }).expect(200);

    expect(res.body.data.user.email).toBe('google-user@gmail.com');
    expect(res.body.data.user.authMethod).toBe('google');

    const inDb = await getUserByEmail('google-user@gmail.com');
    expect(inDb.oauth_provider_id).toBe('google-sub-42');
  });

  test('maps an invalid id_token to 401 INVALID_TOKEN', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

    const res = await postOAuth({ provider: 'google', token: DUMMY_TOKEN }).expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('password login into an account created through OAuth', () => {
  // OAuth sign-up stores password_hash NULL. A typed password is refused like
  // any wrong one — the same 401 body as for an e-mail nobody registered, never
  // a 500 that sets the account apart. «Forgot password» gives the account a
  // password, and from then on it logs in with it like any other.
  const OAUTH_EMAIL = oauthProviderResponses.yandex.default_email;
  const TYPED_PASSWORD = 'Some-Password-123';

  const signUpWithYandex = async () => {
    mockYandexInfo(yandexBody());
    const res = await postOAuth({ provider: 'yandex', token: DUMMY_TOKEN }).expect(200);
    return res.body.data.user;
  };

  const postLogin = (path, email, password) =>
    request(app).post(path).send({ email, password });

  // The admin panel's login calls the same verifyCredentials but writes its
  // own 401 body (adminController.js) — both doors are pinned.
  test.each([
    ['/api/v1/auth/login'],
    ['/api/v1/admin/auth/login'],
  ])('POST %s: 401 INVALID_CREDENTIALS, the same body as for an unknown e-mail', async (path) => {
    await signUpWithYandex();

    const oauthAccount = await postLogin(path, OAUTH_EMAIL, TYPED_PASSWORD);
    const unknownEmail = await postLogin(path, 'nobody-here@yandex.ru', TYPED_PASSWORD);

    expect(oauthAccount.status).toBe(401);
    expect(oauthAccount.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(oauthAccount.body).toEqual(unknownEmail.body);
  });

  test('after «forgot password» the account logs in with the new password', async () => {
    const user = await signUpWithYandex();
    const rawToken = await seedResetToken(user.id);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'NewPass456' })
      .expect(200);

    const login = await postLogin('/api/v1/auth/login', OAUTH_EMAIL, 'NewPass456');

    expect(login.status).toBe(200);
    expect(login.body.data.user.id).toBe(user.id);
    // Premise: still a Yandex account — the password, not auth_method, decides.
    expect(login.body.data.user.authMethod).toBe('yandex');
  });
});
