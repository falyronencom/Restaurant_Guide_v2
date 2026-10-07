/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Stored password hashes keep verifying across an argon2 upgrade.
 *
 * users.password_hash on production holds PHC strings written by argon2 0.31.x.
 * Login (authService.verifyCredentials) must accept them with whatever argon2
 * is installed now — otherwise every existing guest and partner is locked out
 * after a dependency bump. The database is mocked; argon2 is the real module.
 *
 * The two hashes below are literals produced by argon2 0.31.2 on 06.10.2026
 * for a throwaway test password: one with the app's ARGON2_OPTIONS
 * (authService.js), one with the library defaults (scripts/create-test-partner.js
 * and scripts/seed-reviews.js hash without options).
 *
 * The other stored value login meets is no hash at all: an account created
 * through Google or Yandex keeps password_hash NULL (authenticateWithOAuth).
 * The real argon2.verify throws on it («pchstr must be a non-empty string»),
 * which is why the last block also runs against the real module.
 */
import { jest } from '@jest/globals';

const mockPool = { query: jest.fn() };

jest.unstable_mockModule('../../config/database.js', () => ({
  pool: mockPool,
  default: mockPool,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { verifyCredentials } = await import('../../services/authService.js');
const argon2 = (await import('argon2')).default;
const logger = (await import('../../utils/logger.js')).default;

const PASSWORD = 'Пароль-до-обновления-2026';
const HASH_0_31_APP_OPTIONS = '$argon2id$v=19$m=16384,t=3,p=1$eqfvAOPouXq6nsUHI6uqTg$vDqHm7UEUrBkEtKI3Xwlv6SBP3RTmt2kY4nKB1t0P1I';
const HASH_0_31_LIB_DEFAULTS = '$argon2id$v=19$m=65536,t=3,p=4$1vM3trMYpWmTQy15JI01Mg$zXUFKNK/T2A7zOoCO4CYvESLDxlN4DgD81GWX0bwwaQ';

const userRow = (passwordHash) => ({
  id: '3f1c2a9e-8b7d-4c1e-9a2b-1c2d3e4f5a6b',
  email: 'guest@example.com',
  phone: null,
  password_hash: passwordHash,
  name: 'Гость',
  role: 'user',
  auth_method: 'email',
  avatar_url: null,
  is_active: true,
  last_login_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
});

describe('password hashes written by argon2 0.31', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  test.each([
    ['app options (m=16384,t=3,p=1)', HASH_0_31_APP_OPTIONS],
    ['library defaults (m=65536,t=3,p=4)', HASH_0_31_LIB_DEFAULTS],
  ])('%s: the right password logs in', async (_label, hash) => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [userRow(hash)] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE last_login_at

    const user = await verifyCredentials({ email: 'guest@example.com', password: PASSWORD });

    expect(user).not.toBeNull();
    expect(user.id).toBe('3f1c2a9e-8b7d-4c1e-9a2b-1c2d3e4f5a6b');
    expect(user.password_hash).toBeUndefined();
  });

  test('a wrong password is refused', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [userRow(HASH_0_31_APP_OPTIONS)] });

    const user = await verifyCredentials({ email: 'guest@example.com', password: `${PASSWORD}!` });

    expect(user).toBeNull();
  });

  test('an unknown e-mail still runs a full verify against the dummy hash, without throwing', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const verify = jest.spyOn(argon2, 'verify');

    try {
      const user = await verifyCredentials({ email: 'nobody@example.com', password: PASSWORD });

      expect(user).toBeNull();
      // Same cost as a real check (m=16384,t=3,p=1), so response time does not
      // reveal whether the e-mail exists; the dummy must verify to false, not throw.
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0][0]).toMatch(/^\$argon2id\$v=19\$m=16384,t=3,p=1\$/);
      await expect(verify.mock.results[0].value).resolves.toBe(false);
    } finally {
      verify.mockRestore();
    }
  });
});

describe('an account without a password (signed up through Google or Yandex)', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  // A typed password is refused exactly like a wrong one: the same full dummy
  // verify as for an unknown e-mail, then null → the controller's 401
  // INVALID_CREDENTIALS. Before the fix argon2.verify(NULL) threw and login
  // answered 500; skipping the verify instead would answer faster than a wrong
  // password does — either way the response would tell the account type apart.
  test.each([
    ['NULL (OAuth sign-up)', null],
    ["'' (empty)", ''],
  ])('password_hash %s: refused like a wrong password, without throwing', async (_label, storedHash) => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...userRow(storedHash), auth_method: 'google' }],
    });
    const verify = jest.spyOn(argon2, 'verify');

    try {
      const user = await verifyCredentials({ email: 'guest@example.com', password: PASSWORD });

      expect(user).toBeNull();
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0][0]).toMatch(/^\$argon2id\$v=19\$m=16384,t=3,p=1\$/);
      await expect(verify.mock.results[0].value).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Login attempt failed',
        expect.objectContaining({ reason: 'no_password' }),
      );
    } finally {
      verify.mockRestore();
    }
  });
});
