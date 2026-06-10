/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: authService.authenticateWithOAuth
 *
 * The provider-agnostic OAuth identity resolver, exercised in isolation with a
 * mocked pool (pattern per authService.test.js). Covers the three linking
 * scenarios + the security gates (unverified-email claim, deactivated account)
 * + the concurrent-signup unique violation. The real generateTokenPair runs
 * against mocked jwt + pool. Production code unchanged (additive — Discovery Q8).
 */
import { jest } from '@jest/globals';

const mockPool = { query: jest.fn() };

jest.unstable_mockModule('../../config/database.js', () => ({
  pool: mockPool,
  default: mockPool,
}));
jest.unstable_mockModule('../../utils/jwt.js', () => ({
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { pool } = await import('../../config/database.js');
const { generateAccessToken, generateRefreshToken } = await import('../../utils/jwt.js');
const { authenticateWithOAuth } = await import('../../services/authService.js');

const yandexProvider = (overrides = {}) => ({
  providerId: 'yx-pid-1',
  email: 'user@yandex.ru',
  name: 'Аня',
  avatarUrl: null,
  emailVerified: true,
  provider: 'yandex',
  ...overrides,
});

const userRow = (overrides = {}) => ({
  id: 'user-1',
  email: 'user@yandex.ru',
  phone: null,
  name: 'Аня',
  role: 'user',
  auth_method: 'yandex',
  avatar_url: null,
  oauth_provider_id: 'yx-pid-1',
  is_active: true,
  last_login_at: null,
  created_at: new Date(),
  ...overrides,
});

/**
 * Route pool.query by SQL fragment (robust to call ordering). Each scenario
 * supplies the lookup result sets; the refresh_tokens insert always succeeds.
 */
function mockPoolFor({ oauthRows = [], emailRows = [], returnedUser = null, insertError = null }) {
  pool.query.mockImplementation((sql) => {
    if (sql.includes('auth_method = $1 AND oauth_provider_id')) return Promise.resolve({ rows: oauthRows });
    if (sql.includes('WHERE email = $1')) return Promise.resolve({ rows: emailRows });
    if (sql.includes('INSERT INTO users')) {
      return insertError ? Promise.reject(insertError) : Promise.resolve({ rows: [returnedUser] });
    }
    if (sql.includes('SET auth_method')) return Promise.resolve({ rows: [returnedUser] });
    if (sql.includes('INSERT INTO refresh_tokens')) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [] }); // last_login_at update, etc.
  });
}

describe('authenticateWithOAuth', () => {
  beforeEach(() => {
    // resetMocks:true wipes return values each test (feedback_jest_resetmocks).
    generateAccessToken.mockReturnValue('access-token');
    generateRefreshToken.mockReturnValue('refresh-token');
  });

  const insertedUsers = () =>
    pool.query.mock.calls.some((c) => c[0].includes('INSERT INTO users'));
  const linked = () => pool.query.mock.calls.some((c) => c[0].includes('SET auth_method'));

  test('scenario 1 — existing OAuth user logs in (matched on auth_method + provider id)', async () => {
    mockPoolFor({ oauthRows: [userRow()] });

    const result = await authenticateWithOAuth(yandexProvider());

    expect(result.user.id).toBe('user-1');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(insertedUsers()).toBe(false); // login path — no user INSERT
  });

  test('scenario 2 — verified email links onto an existing account', async () => {
    const existing = userRow({ auth_method: 'email', oauth_provider_id: null });
    mockPoolFor({
      oauthRows: [],
      emailRows: [existing],
      returnedUser: userRow({ auth_method: 'yandex' }),
    });

    const result = await authenticateWithOAuth(yandexProvider());

    expect(result.user.auth_method).toBe('yandex');
    expect(result.accessToken).toBe('access-token');
    expect(linked()).toBe(true);
  });

  test('scenario 3 — no match creates a new user', async () => {
    mockPoolFor({ oauthRows: [], emailRows: [], returnedUser: userRow({ id: 'new-user' }) });

    const result = await authenticateWithOAuth(yandexProvider());

    expect(result.user.id).toBe('new-user');
    expect(insertedUsers()).toBe(true);
  });

  test('rejects an unverified-email claim on an existing account (security gate)', async () => {
    mockPoolFor({ oauthRows: [], emailRows: [userRow({ auth_method: 'email' })] });

    await expect(
      authenticateWithOAuth(yandexProvider({ emailVerified: false })),
    ).rejects.toThrow('OAUTH_EMAIL_NOT_VERIFIED');

    expect(linked()).toBe(false); // no account takeover
  });

  test('maps a concurrent-signup unique violation (23505) to OAUTH_ACCOUNT_CONFLICT', async () => {
    const dupErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    mockPoolFor({ oauthRows: [], emailRows: [], insertError: dupErr });

    await expect(authenticateWithOAuth(yandexProvider())).rejects.toThrow('OAUTH_ACCOUNT_CONFLICT');
  });

  test('rejects a deactivated existing OAuth account', async () => {
    mockPoolFor({ oauthRows: [userRow({ is_active: false })] });

    await expect(authenticateWithOAuth(yandexProvider())).rejects.toThrow('ACCOUNT_DEACTIVATED');
  });
});
