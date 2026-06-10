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
 * path that previously had none (Discovery Q8).
 *
 * google-auth-library is mocked via unstable_mockModule, so app (which imports
 * it transitively through oauthService) is dynamically imported AFTER the mock.
 */
import { jest } from '@jest/globals';

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

const request = (await import('supertest')).default;
const app = (await import('../../server.js')).default;
const { clearAllData } = await import('../utils/database.js');
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
