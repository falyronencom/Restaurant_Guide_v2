/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: authService.js
 *
 * Tests authentication business logic in isolation using mocked dependencies.
 * These tests verify:
 * - User registration flow
 * - Credential verification (constant-time)
 * - Token generation and management
 * - Token refresh with strict rotation
 * - Security measures (token reuse detection)
 */

import { jest } from '@jest/globals';

// Mock dependencies BEFORE importing service
const mockPool = {
  query: jest.fn(),
};

jest.unstable_mockModule('../../config/database.js', () => ({
  getClient: jest.fn(),
  pool: mockPool,
  default: mockPool,
}));

jest.unstable_mockModule('argon2', () => ({
  default: {
    hash: jest.fn(),
    verify: jest.fn(),
    argon2id: 0,
  },
}));

jest.unstable_mockModule('../../utils/jwt.js', () => ({
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
  deriveSuccessorRefreshToken: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
const { pool, getClient } = await import('../../config/database.js');
const argon2 = (await import('argon2')).default;
const {
  generateAccessToken,
  generateRefreshToken,
  deriveSuccessorRefreshToken,
} = await import('../../utils/jwt.js');
const logger = (await import('../../utils/logger.js')).default;
// Not mocked: the hash a token is stored under is part of the contract.
const { storedRefreshToken } = await import('../../utils/refreshTokenStorage.js');

/**
 * Stand-in for the successor derivation (utils/jwt.js): readable, and a
 * function of both inputs, like the real one.
 */
const successorOf = (predecessor, successorId) => `successor-of:${predecessor}:${successorId}`;

const {
  createUser,
  verifyCredentials,
  generateTokenPair,
  refreshAccessToken,
  invalidateRefreshToken,
  invalidateAllUserTokens,
  findUserById,
} = await import('../../services/authService.js');

import {
  createMockUser,
} from '../mocks/helpers.js';

/**
 * The connection invalidateAllUserTokens takes for its transaction: ending
 * every session burns the refresh tokens and stamps sessions_revoked_at
 * together, so it no longer goes through pool.query. `burned` is the number
 * of refresh tokens the burn reports.
 */
const mockClient = { query: jest.fn(), release: jest.fn() };
const routeClient = ({ burned = 0 } = {}) => {
  mockClient.query.mockImplementation((sql) => Promise.resolve(
    sql.startsWith('UPDATE refresh_tokens') ? { rows: [], rowCount: burned } : { rows: [], rowCount: 0 }
  ));
};
const clientStatements = () => mockClient.query.mock.calls.map(([sql]) => sql);

/** The revocation that a reuse verdict runs, as the transaction shows it. */
const expectSessionsRevoked = (userId) => {
  const statements = clientStatements();
  const burn = statements.findIndex((sql) => sql.startsWith('UPDATE refresh_tokens SET used_at'));
  const stamp = statements.findIndex((sql) => sql.startsWith('UPDATE users SET sessions_revoked_at'));
  expect(statements[0]).toBe('BEGIN');
  expect(burn).toBeGreaterThan(0);
  // The stamp follows the burn (accountStatus.markSessionsRevoked says why).
  expect(stamp).toBeGreaterThan(burn);
  expect(statements[statements.length - 1]).toBe('COMMIT');
  expect(mockClient.query.mock.calls[burn][1]).toEqual([expect.any(Date), userId]);
  expect(mockClient.query.mock.calls[stamp][1]).toEqual([userId, expect.any(Date)]);
  expect(mockClient.release).toHaveBeenCalledTimes(1);
};

describe('authService', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    getClient.mockResolvedValue(mockClient);
    routeClient();
    deriveSuccessorRefreshToken.mockImplementation(successorOf);
  });

  describe('createUser', () => {
    test('should create new user with hashed password', async () => {
      const userData = {
        email: 'newuser@test.com',
        phone: '+375291234567',
        password: 'SecurePassword123!',
        name: 'Test User',
        authMethod: 'email',
      };

      const mockUser = createMockUser({
        email: 'newuser@test.com',
        phone: '+375291234567',
        name: 'Test User',
      });

      // Mock argon2 hash
      argon2.hash.mockResolvedValue('hashed_password_123');

      // Mock database insert
      pool.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1,
      });

      const result = await createUser(userData);

      // Verify password was hashed
      expect(argon2.hash).toHaveBeenCalledWith(
        userData.password,
        expect.objectContaining({
          type: argon2.argon2id,
          memoryCost: 16384,
          timeCost: 3,
          parallelism: 1,
        })
      );

      // Verify database insert
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining([
          expect.any(String), // userId (UUID)
          'newuser@test.com',
          '+375291234567',
          'hashed_password_123',
          'Test User',
          'user', // Default role
          'email',
          false, // email_verified
          false, // phone_verified
          true,  // is_active
          expect.any(Date),
          expect.any(Date),
        ])
      );

      expect(result).toEqual(mockUser);
      expect(logger.info).toHaveBeenCalledWith(
        'User created successfully',
        expect.objectContaining({ userId: mockUser.id })
      );
    });

    test('should normalize email to lowercase', async () => {
      const userData = {
        email: 'UPPERCASE@TEST.COM',
        password: 'SecurePassword123!',
        name: 'Test User',
        authMethod: 'email',
      };

      argon2.hash.mockResolvedValue('hashed_password');
      pool.query.mockResolvedValue({
        rows: [createMockUser({ email: 'uppercase@test.com' })],
        rowCount: 1,
      });

      await createUser(userData);

      // Verify email was lowercased in query
      const queryArgs = pool.query.mock.calls[0][1];
      expect(queryArgs[1]).toBe('uppercase@test.com');
    });

    test('should throw EMAIL_ALREADY_EXISTS on duplicate email', async () => {
      const userData = {
        email: 'existing@test.com',
        password: 'Password123!',
        name: 'Test User',
        authMethod: 'email',
      };

      argon2.hash.mockResolvedValue('hashed_password');

      // Mock PostgreSQL unique violation error
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'users_email_key';
      pool.query.mockRejectedValue(error);

      await expect(createUser(userData)).rejects.toThrow('EMAIL_ALREADY_EXISTS');
    });

    test('should throw PHONE_ALREADY_EXISTS on duplicate phone', async () => {
      const userData = {
        phone: '+375291234567',
        password: 'Password123!',
        name: 'Test User',
        authMethod: 'phone',
      };

      argon2.hash.mockResolvedValue('hashed_password');

      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'users_phone_key';
      pool.query.mockRejectedValue(error);

      await expect(createUser(userData)).rejects.toThrow('PHONE_ALREADY_EXISTS');
    });

    test('should handle database errors gracefully', async () => {
      const userData = {
        email: 'test@test.com',
        password: 'Password123!',
        name: 'Test User',
        authMethod: 'email',
      };

      argon2.hash.mockResolvedValue('hashed_password');
      pool.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(createUser(userData)).rejects.toThrow('Database connection failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('verifyCredentials', () => {
    test('should verify valid email and password', async () => {
      const credentials = {
        email: 'user@test.com',
        password: 'CorrectPassword123!',
      };

      const mockUser = createMockUser({
        email: 'user@test.com',
        password_hash: 'hashed_password',
      });

      // Mock user lookup
      pool.query.mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      });

      // Mock password verification (success)
      argon2.verify.mockResolvedValue(true);

      // Mock last login update
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await verifyCredentials(credentials);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
      expect(result.password_hash).toBeUndefined(); // Should be removed

      // Verify password was checked
      expect(argon2.verify).toHaveBeenCalledWith(
        'hashed_password',
        'CorrectPassword123!'
      );

      // Verify last_login_at was updated
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE users SET last_login_at'),
        expect.arrayContaining([expect.any(Date), mockUser.id])
      );

      expect(logger.info).toHaveBeenCalledWith(
        'User login successful',
        expect.objectContaining({ userId: mockUser.id })
      );
    });

    test('should verify valid phone and password', async () => {
      const credentials = {
        phone: '+375291234567',
        password: 'CorrectPassword123!',
      };

      const mockUser = createMockUser({
        phone: '+375291234567',
        password_hash: 'hashed_password',
      });

      pool.query.mockResolvedValueOnce({ rows: [mockUser] });
      argon2.verify.mockResolvedValue(true);
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await verifyCredentials(credentials);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
    });

    test('should return null for wrong password (constant-time)', async () => {
      const credentials = {
        email: 'user@test.com',
        password: 'WrongPassword123!',
      };

      const mockUser = createMockUser({
        email: 'user@test.com',
        password_hash: 'hashed_password',
      });

      pool.query.mockResolvedValue({ rows: [mockUser] });
      argon2.verify.mockResolvedValue(false); // Password mismatch

      const result = await verifyCredentials(credentials);

      expect(result).toBeNull();
      expect(argon2.verify).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Login attempt failed',
        expect.objectContaining({ reason: 'invalid_password' })
      );
    });

    test('should return null for non-existent user (constant-time)', async () => {
      const credentials = {
        email: 'nonexistent@test.com',
        password: 'Password123!',
      };

      pool.query.mockResolvedValue({ rows: [] });
      argon2.verify.mockResolvedValue(false); // Dummy verification

      const result = await verifyCredentials(credentials);

      expect(result).toBeNull();

      // CRITICAL: Verify dummy hash was checked (constant-time protection)
      expect(argon2.verify).toHaveBeenCalledWith(
        expect.stringContaining('$argon2id'),
        'Password123!'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Login attempt failed',
        expect.objectContaining({ reason: 'user_not_found' })
      );
    });

    test('should normalize email to lowercase for lookup', async () => {
      const credentials = {
        email: 'UPPERCASE@TEST.COM',
        password: 'Password123!',
      };

      pool.query.mockResolvedValue({ rows: [] });
      argon2.verify.mockResolvedValue(false);

      await verifyCredentials(credentials);

      const queryArgs = pool.query.mock.calls[0][1];
      expect(queryArgs[0]).toBe('uppercase@test.com');
    });
  });

  describe('generateTokenPair', () => {
    test('should generate access and refresh tokens', async () => {
      const user = createMockUser({
        id: 'user-123',
        email: 'user@test.com',
        role: 'user',
      });

      generateAccessToken.mockReturnValue('access_token_abc');
      generateRefreshToken.mockReturnValue('refresh_token_xyz');

      pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await generateTokenPair(user);

      // refreshTokenId is the id of the row just inserted. refreshAccessToken
      // writes it into the predecessor's replaced_by, which is what lets a
      // replay inside the grace window find this successor. It is bookkeeping:
      // every caller builds its HTTP response field by field, so it never
      // reaches a client.
      expect(result).toEqual({
        accessToken: 'access_token_abc',
        refreshToken: 'refresh_token_xyz',
        expiresIn: 14400,
        refreshTokenId: expect.any(String),
      });

      // Verify access token was generated with user data
      expect(generateAccessToken).toHaveBeenCalledWith({
        userId: user.id,
        role: user.role,
        email: user.email,
      });

      // Verify refresh token was stored in database — as its hash
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        expect.arrayContaining([
          expect.any(String), // tokenId (UUID)
          user.id,
          storedRefreshToken('refresh_token_xyz'),
          expect.any(Date), // expires_at (30 days)
          expect.any(Date), // created_at
          null, // used_at
        ])
      );
      // The token itself never reaches the database
      expect(pool.query.mock.calls[0][1]).not.toContain('refresh_token_xyz');
      // A new session starts from random bytes, not from a derivation
      expect(deriveSuccessorRefreshToken).not.toHaveBeenCalled();

      expect(logger.info).toHaveBeenCalledWith(
        'Token pair generated',
        expect.objectContaining({ userId: user.id })
      );
    });

    test('a rotation derives its successor from the token it replaces and this row\'s id', async () => {
      const user = createMockUser({ id: 'user-123' });
      generateAccessToken.mockReturnValue('access_token_abc');
      pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await generateTokenPair(user, { replaces: 'predecessor_token' });

      // The grace window computes the successor again from the replayed token
      // and the row id — so both must be what it was derived from here.
      const [, insertParams] = pool.query.mock.calls[0];
      const rowId = insertParams[0];
      expect(deriveSuccessorRefreshToken).toHaveBeenCalledWith('predecessor_token', rowId);
      expect(generateRefreshToken).not.toHaveBeenCalled();
      expect(result.refreshToken).toBe(successorOf('predecessor_token', rowId));
      expect(result.refreshTokenId).toBe(rowId);
      expect(insertParams[2]).toBe(storedRefreshToken(result.refreshToken));
    });

    test('should handle database errors when storing token', async () => {
      const user = createMockUser();

      generateAccessToken.mockReturnValue('access_token');
      generateRefreshToken.mockReturnValue('refresh_token');
      pool.query.mockRejectedValue(new Error('Database error'));

      await expect(generateTokenPair(user)).rejects.toThrow('Database error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('refreshAccessToken', () => {
    test('should refresh token successfully with valid refresh token', async () => {
      const refreshToken = 'valid_refresh_token';
      const mockUser = createMockUser({
        id: 'user-123',
        email: 'user@test.com',
        role: 'user',
      });

      const mockTokenData = {
        id: 'token-123',
        user_id: mockUser.id,
        token: refreshToken,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        used_at: null,
        ...mockUser,
        is_active: true,
      };

      // Mock token lookup
      pool.query.mockResolvedValueOnce({
        rows: [mockTokenData],
        rowCount: 1,
      });

      // Mock marking token as used
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      // Mock new token insertion
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      generateAccessToken.mockReturnValue('new_access_token');
      deriveSuccessorRefreshToken.mockReturnValue('new_refresh_token');

      const result = await refreshAccessToken(refreshToken);

      expect(result.accessToken).toBe('new_access_token');
      expect(result.refreshToken).toBe('new_refresh_token');
      expect(result.user).toBeDefined();
      expect(result.user.id).toBe(mockUser.id);

      // Looked up by its hash — the only thing the table holds for it
      expect(pool.query.mock.calls[0][1]).toEqual([storedRefreshToken(refreshToken)]);
      // The successor comes from the token it replaces, never from random bytes
      expect(generateRefreshToken).not.toHaveBeenCalled();
      expect(deriveSuccessorRefreshToken).toHaveBeenCalledWith(refreshToken, expect.any(String));

      // The old row is burned and its successor named in ONE statement, so no
      // moment exists where used_at is set and replaced_by is still null.
      // NOW() rather than a JS Date: the grace window is compared in SQL, and
      // used_at is `timestamp without time zone` — a JS Date on one side of
      // that comparison would carry the process offset silently.
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET used_at = NOW(), replaced_by = $1'),
        [expect.any(String), mockUser.id]
      );

      // `used_at IS NULL` is the guard that makes two simultaneous refreshes of
      // one token produce exactly one chain instead of two.
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('used_at IS NULL'),
        [expect.any(String), mockUser.id]
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Access token refreshed successfully',
        expect.objectContaining({ userId: mockUser.id })
      );
    });

    test('should throw INVALID_REFRESH_TOKEN if token not found', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(refreshAccessToken('invalid_token')).rejects.toThrow(
        'INVALID_REFRESH_TOKEN'
      );

      expect(logger.warn).toHaveBeenCalledWith('Refresh token not found');
    });

    // Until 30.10.2026 the line carried the token's first 10 characters. The
    // logger blanked the field by its name (`token`), but the piece was still
    // handed over — not one character of it is now.
    test('the not-found line carries no piece of the presented token', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const presented = `f3a9c2e17b4d58a6${'0'.repeat(48)}`; // the 64-hex shape of a real one

      await expect(refreshAccessToken(presented)).rejects.toThrow('INVALID_REFRESH_TOKEN');

      const line = logger.warn.mock.calls.find(([message]) => message === 'Refresh token not found');
      expect(line).toEqual(['Refresh token not found']);
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('f3a9');
    });

    test('should throw REFRESH_TOKEN_EXPIRED if token expired', async () => {
      const expiredTokenData = {
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() - 1000), // Expired 1 second ago
        used_at: null,
        is_active: true,
      };

      pool.query.mockResolvedValue({
        rows: [expiredTokenData],
        rowCount: 1,
      });

      await expect(refreshAccessToken('expired_token')).rejects.toThrow(
        'REFRESH_TOKEN_EXPIRED'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Expired refresh token used',
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    test('should detect token reuse and invalidate all user tokens (SECURITY)', async () => {
      const reusedTokenData = {
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        used_at: new Date(Date.now() - 60000), // Used 1 minute ago
        is_active: true,
      };

      // Mock token lookup
      pool.query.mockResolvedValueOnce({
        rows: [reusedTokenData],
        rowCount: 1,
      });

      // Invalidating all tokens: 3 refresh tokens burned
      routeClient({ burned: 3 });

      await expect(refreshAccessToken('reused_token')).rejects.toThrow(
        'REFRESH_TOKEN_REUSE_DETECTED'
      );

      // Verify security alert logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY ALERT'),
        expect.objectContaining({ userId: 'user-123' })
      );

      // Verify all user tokens were invalidated — refresh tokens burned and
      // the access tokens issued until now refused, in one transaction
      expectSessionsRevoked('user-123');

      expect(logger.warn).toHaveBeenCalledWith(
        'All refresh tokens invalidated for user',
        expect.objectContaining({ userId: 'user-123', tokenCount: 3, accessTokensRevoked: true })
      );
    });

    describe('a token created before the account sessions were revoked', () => {
      const REVOKED_AT = new Date('2026-10-12T09:00:00.500Z');

      /**
       * A row whose account had its sessions revoked at REVOKED_AT — by a
       * password reset, a reuse alarm or a takeover, which also burned the
       * token (used_at set, no successor).
       */
      const rowCreatedAt = (createdAt, overrides = {}) => ({
        id: 'token-1',
        user_id: 'user-123',
        token: 'old_token',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        created_at: createdAt,
        used_at: new Date(REVOKED_AT.getTime()),
        replaced_by: null,
        email: 'user@test.com',
        phone: null,
        name: 'Test User',
        role: 'user',
        is_active: true,
        sessions_revoked_at: REVOKED_AT,
        ...overrides,
      });

      test('is refused as REFRESH_TOKEN_REVOKED — no reuse alarm, no second revocation', async () => {
        pool.query.mockResolvedValueOnce({
          rows: [rowCreatedAt(new Date(REVOKED_AT.getTime() - 1))],
          rowCount: 1,
        });

        await expect(refreshAccessToken('old_token')).rejects.toThrow('REFRESH_TOKEN_REVOKED');

        // The reuse verdict would revoke every session again — the one opened
        // after the reset included — each time a stale device woke up.
        expect(logger.error).not.toHaveBeenCalledWith(
          expect.stringContaining('SECURITY ALERT'),
          expect.anything()
        );
        expect(getClient).not.toHaveBeenCalled();
        expect(pool.query).toHaveBeenCalledTimes(1);
      });

      test('an unused one too: a token a race left unburned is dead all the same', async () => {
        pool.query.mockResolvedValueOnce({
          rows: [rowCreatedAt(new Date(REVOKED_AT.getTime() - 1), { used_at: null })],
          rowCount: 1,
        });

        await expect(refreshAccessToken('old_token')).rejects.toThrow('REFRESH_TOKEN_REVOKED');
        expect(pool.query).toHaveBeenCalledTimes(1);
      });

      test('created at the stamp itself it is not — a burned one goes on to the reuse verdict', async () => {
        pool.query.mockResolvedValueOnce({
          rows: [rowCreatedAt(new Date(REVOKED_AT.getTime()))],
          rowCount: 1,
        });

        await expect(refreshAccessToken('old_token')).rejects.toThrow('REFRESH_TOKEN_REUSE_DETECTED');
      });

      test('a claim lost to the revocation itself ends in REFRESH_TOKEN_REVOKED, not in a replay', async () => {
        const createdAt = new Date(REVOKED_AT.getTime() - 1000);
        pool.query
          // 1. lookup: unused, and no revocation yet
          .mockResolvedValueOnce({
            rows: [rowCreatedAt(createdAt, { used_at: null, sessions_revoked_at: null })],
            rowCount: 1,
          })
          // 2. successor inserted
          .mockResolvedValueOnce({ rows: [], rowCount: 1 })
          // 3. claim finds the token burned — by the revocation
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          // 4. orphan successor removed
          .mockResolvedValueOnce({ rows: [], rowCount: 1 })
          // 5. re-read: the account's sessions were revoked meanwhile
          .mockResolvedValueOnce({ rows: [rowCreatedAt(createdAt)], rowCount: 1 });
        generateAccessToken.mockReturnValue('never_handed_out');

        await expect(refreshAccessToken('old_token')).rejects.toThrow('REFRESH_TOKEN_REVOKED');
        expect(pool.query).toHaveBeenCalledTimes(5);
      });
    });

    test('should throw USER_ACCOUNT_INACTIVE if account disabled', async () => {
      const inactiveUserData = {
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        used_at: null,
        is_active: false, // Account disabled
      };

      pool.query.mockResolvedValue({
        rows: [inactiveUserData],
        rowCount: 1,
      });

      await expect(refreshAccessToken('token')).rejects.toThrow(
        'USER_ACCOUNT_INACTIVE'
      );
    });
    /**
     * Reuse grace window (config/auth.js)
     *
     * A replayed refresh token is either theft or a rotation whose answer was
     * lost on the way back. Strict rotation calls both theft and charges the
     * user every session they have. The window separates them: inside it the
     * same successor is handed back, outside it the original verdict stands.
     *
     * Every test states its own window instead of trusting the environment —
     * .env.test is generated by CI and .env can leak into a local run.
     */
    describe('reuse grace window', () => {
      const GRACE_ENV = 'REFRESH_REUSE_GRACE_SECONDS';
      let originalGrace;

      beforeEach(() => {
        originalGrace = process.env[GRACE_ENV];
      });

      afterEach(() => {
        if (originalGrace === undefined) {
          delete process.env[GRACE_ENV];
        } else {
          process.env[GRACE_ENV] = originalGrace;
        }
      });

      /**
       * A refresh-token row joined with its user, already burned by a rotation
       * that named `successor-1` as its replacement. Fields are spelled out
       * rather than spread from a mock user: the row's own id must stay
       * distinct from the user id for the assertions below to mean anything.
       */
      const burnedRow = (overrides = {}) => ({
        id: 'token-1',
        user_id: 'user-123',
        token: 'burned_token',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        used_at: new Date(Date.now() - 2000),
        replaced_by: 'successor-1',
        email: 'user@test.com',
        phone: null,
        name: 'Test User',
        role: 'user',
        is_active: true,
        ...overrides,
      });

      /**
       * The successor row as the window query returns it. Its token column
       * holds the hash of the token a rotation of `presented` derived for it
       * — which is all the database ever has of that token.
       */
      const liveSuccessor = ({ presented = 'burned_token', ...overrides } = {}) => ({
        id: 'successor-1',
        token: storedRefreshToken(successorOf(presented, 'successor-1')),
        used_at: null,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        replay_age_seconds: '2.5', // NUMERIC arrives from node-pg as a string
        ...overrides,
      });

      /** What a replay of 'burned_token' is handed back: derived again, not read. */
      const SUCCESSOR_TOKEN = successorOf('burned_token', 'successor-1');

      test('replay inside the window returns THE SAME successor and mints no new row', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })      // lookup
          .mockResolvedValueOnce({ rows: [liveSuccessor()], rowCount: 1 }); // window

        generateAccessToken.mockReturnValue('replayed_access_token');

        const result = await refreshAccessToken('burned_token');

        expect(result).toEqual({
          accessToken: 'replayed_access_token',
          refreshToken: SUCCESSOR_TOKEN,
          expiresIn: 14400,
          user: expect.objectContaining({ id: 'user-123', role: 'user' }),
        });
        expect(deriveSuccessorRefreshToken).toHaveBeenCalledWith('burned_token', 'successor-1');

        // Two queries and no more. Handing back a NEW pair instead of the
        // existing successor would fork the chain and cost the window its
        // whole point, so "nothing was inserted" is the assertion that matters.
        expect(pool.query).toHaveBeenCalledTimes(2);
        expect(pool.query).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO refresh_tokens'),
          expect.anything()
        );
        expect(logger.error).not.toHaveBeenCalled();

        expect(logger.info).toHaveBeenCalledWith(
          'Refresh token replayed within grace window',
          expect.objectContaining({
            event: 'refresh_token_replayed_within_grace',
            userId: 'user-123',
            tokenId: 'token-1',
            ageMs: 2500,
            graceSeconds: 60,
          })
        );
      });

      test('the window is compared in SQL against the column clock, never in JS', async () => {
        process.env[GRACE_ENV] = '45';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [liveSuccessor()], rowCount: 1 });
        generateAccessToken.mockReturnValue('replayed_access_token');

        await refreshAccessToken('burned_token');

        // used_at is `timestamp without time zone` and was written by NOW().
        // Comparing it against a JS Date applies the process offset to one
        // side only — the window silently widens or shuts by that offset.
        const [windowSql, windowParams] = pool.query.mock.calls[1];
        expect(windowSql).toContain(
          'burned.used_at BETWEEN NOW() - make_interval(secs => $2) AND NOW()'
        );
        expect(windowParams).toEqual(['token-1', 45, false]);
      });

      test('the window has an upper bound, so a future used_at is not forgiven forever', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [liveSuccessor()], rowCount: 1 });
        generateAccessToken.mockReturnValue('replayed_access_token');

        await refreshAccessToken('burned_token');

        // used_at is still written by a JS Date on the logout and revoke paths,
        // and a JS Date reaches a naive column in local time — three hours
        // ahead of NOW() under TZ=Europe/Minsk. A one-sided lower bound accepts
        // any future timestamp, so such a row would sit inside the window
        // forever. Those rows carry no successor today; the bound is what keeps
        // the window from depending on that staying true.
        expect(pool.query.mock.calls[1][0]).toContain('AND NOW()');
      });

      test('the successor must belong to the same user as the token replayed', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [liveSuccessor()], rowCount: 1 });
        generateAccessToken.mockReturnValue('replayed_access_token');

        await refreshAccessToken('burned_token');

        // The access token is minted from the BURNED row's user while the
        // refresh token comes from the successor row. The foreign key pins
        // replaced_by to a refresh_tokens id, not to a user, so without this
        // clause a cross-user link would hand out one user's access token
        // beside another user's refresh token.
        expect(pool.query.mock.calls[1][0]).toContain('successor.user_id = burned.user_id');
      });

      test('replay outside the window keeps the original verdict', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // window missed
        routeClient({ burned: 3 }); // revoke

        await expect(refreshAccessToken('burned_token')).rejects.toThrow(
          'REFRESH_TOKEN_REUSE_DETECTED'
        );

        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('SECURITY ALERT'),
          expect.objectContaining({ userId: 'user-123' })
        );
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('WHERE user_id = $2 AND used_at IS NULL'),
          expect.arrayContaining([expect.any(Date), 'user-123'])
        );
        expectSessionsRevoked('user-123');
      });

      test('replay is refused once the successor itself has been used', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
          .mockResolvedValueOnce({
            // The client demonstrably received the successor and moved on, so
            // a replay of its predecessor is no longer a lost answer.
            rows: [liveSuccessor({ used_at: new Date(Date.now() - 500) })],
            rowCount: 1,
          });
        routeClient({ burned: 2 }); // revoke

        await expect(refreshAccessToken('burned_token')).rejects.toThrow(
          'REFRESH_TOKEN_REUSE_DETECTED'
        );

        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('SECURITY ALERT'),
          expect.objectContaining({ userId: 'user-123' })
        );
      });

      test('a deactivated account is not served from the window', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow({ is_active: false })], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // burn: already used

        await expect(refreshAccessToken('burned_token')).rejects.toThrow(
          'USER_ACCOUNT_INACTIVE'
        );

        // The window is not even consulted: it forgives a lost answer, never a
        // closed account. Since 30.10.2026 the switched-off check runs first,
        // so the verdict is ACCOUNT_INACTIVE — the one code on which the
        // clients tell the person why (the block from the panel revokes the
        // sessions too). Lookup and the no-op burn only: no successor, no
        // claim, no transaction.
        expect(pool.query).toHaveBeenCalledTimes(2);
        expect(pool.query.mock.calls[1][0]).toMatch(/^UPDATE refresh_tokens SET used_at = NOW\(\)/);
        expect(getClient).not.toHaveBeenCalled();
        // A replay of a rotated token still leaves a trace.
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('switched-off account'),
          expect.objectContaining({ userId: 'user-123', alreadyUsed: true }),
        );
      });

      test('a token burned by logout has no successor and is never forgiven', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow({ replaced_by: null })], rowCount: 1 });
        routeClient({ burned: 1 }); // revoke

        await expect(refreshAccessToken('burned_token')).rejects.toThrow(
          'REFRESH_TOKEN_REUSE_DETECTED'
        );

        // Exactly one query on the pool, the lookup; the revocation runs in a
        // transaction of its own. With replaced_by null there
        // is nothing to hand back, so the window is never consulted — which is
        // also what keeps the mock sequence of every older reuse test intact.
        expect(pool.query).toHaveBeenCalledTimes(1);
        expectSessionsRevoked('user-123');
      });

      // Scoped to a stale replay on purpose: the claim-race caller is answered
      // whatever this setting says, and the test below that one covers it.
      test('REFRESH_REUSE_GRACE_SECONDS=0 refuses a stale replay', async () => {
        process.env[GRACE_ENV] = '0';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 }); // successor exists...
        routeClient({ burned: 1 }); // ...and is never looked at

        await expect(refreshAccessToken('burned_token')).rejects.toThrow(
          'REFRESH_TOKEN_REUSE_DETECTED'
        );

        expect(pool.query).toHaveBeenCalledTimes(1);
        expectSessionsRevoked('user-123');
      });

      test('a malformed window value falls back to the default, it does not disarm', async () => {
        process.env[GRACE_ENV] = '60s';

        pool.query
          .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [liveSuccessor()], rowCount: 1 });
        generateAccessToken.mockReturnValue('replayed_access_token');

        const result = await refreshAccessToken('burned_token');

        // A typo turning the window off would be discovered as a wave of
        // forced logouts during the next deploy, with nothing in the logs
        // naming the cause.
        expect(result.refreshToken).toBe(SUCCESSOR_TOKEN);
        expect(pool.query.mock.calls[1][1]).toEqual(['token-1', 60, false]);
      });

      test('losing the claim race deletes the orphan and replays the winner', async () => {
        process.env[GRACE_ENV] = '60';

        pool.query
          // 1. lookup: the token is still unused as far as this request knows
          .mockResolvedValueOnce({
            rows: [burnedRow({ token: 'live_token', used_at: null, replaced_by: null })],
            rowCount: 1,
          })
          // 2. this request inserts its own successor
          .mockResolvedValueOnce({ rows: [], rowCount: 1 })
          // 3. claim finds used_at already set by the winner
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          // 4. orphan successor removed
          .mockResolvedValueOnce({ rows: [], rowCount: 1 })
          // 5. re-read: the row now carries the winner's used_at and successor
          .mockResolvedValueOnce({
            rows: [burnedRow({ token: 'live_token' })],
            rowCount: 1,
          })
          // 6. window: the winner's successor is still live
          .mockResolvedValueOnce({ rows: [liveSuccessor({ presented: 'live_token' })], rowCount: 1 });

        generateAccessToken.mockReturnValue('winner_access_token');

        const result = await refreshAccessToken('live_token');

        // The loser receives the winner's successor rather than a 403 or a
        // second chain of its own — one token in, one chain out. Both derived
        // a successor from the same token, each under its own row id, so the
        // loser's orphan and the winner's successor are different tokens.
        expect(result.refreshToken).toBe(successorOf('live_token', 'successor-1'));
        expect(result.accessToken).toBe('winner_access_token');

        // The successor this request inserted before losing must not survive:
        // an unreferenced live refresh token is a token nobody can revoke.
        // Pinned to the id the INSERT actually used — `expect.any(String)` here
        // would be just as happy with the predecessor or the winner's successor
        // being deleted instead.
        const insertCall = pool.query.mock.calls.find(
          ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO refresh_tokens')
        );
        const orphanId = insertCall[1][0];
        expect(orphanId).not.toBe('token-1');
        expect(orphanId).not.toBe('successor-1');
        expect(pool.query).toHaveBeenCalledWith(
          'DELETE FROM refresh_tokens WHERE id = $1',
          [orphanId]
        );
        expect(logger.error).not.toHaveBeenCalled();
      });

      test('losing the claim race is answered even when the window is off', async () => {
        process.env[GRACE_ENV] = '0';

        pool.query
          .mockResolvedValueOnce({
            rows: [burnedRow({ token: 'live_token', used_at: null, replaced_by: null })],
            rowCount: 1,
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert successor
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // claim lost
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // orphan removed
          .mockResolvedValueOnce({ rows: [burnedRow({ token: 'live_token' })], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [liveSuccessor({ presented: 'live_token' })], rowCount: 1 });

        generateAccessToken.mockReturnValue('winner_access_token');

        const result = await refreshAccessToken('live_token');

        // Turning the window off means "a stale replay is theft again". It must
        // not also mean "two tabs refreshing at the same instant lose the
        // account" — before the atomic claim both simply rotated, and that
        // regression would be introduced by this change, not chosen by it.
        expect(result.refreshToken).toBe(successorOf('live_token', 'successor-1'));
        expect(logger.error).not.toHaveBeenCalled();

        // The age bound is skipped for this caller, and only for this caller.
        expect(pool.query.mock.calls[5][1]).toEqual(['token-1', 0, true]);
      });

      describe('the successor\'s token is in the database only as a hash', () => {
        test('a successor whose token cannot be derived again is not handed out — and is not called theft', async () => {
          process.env[GRACE_ENV] = '60';

          pool.query
            .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
            .mockResolvedValueOnce({
              // A hashed row that no derivation from the replayed token
              // reproduces — after a JWT_SECRET change, for one.
              rows: [liveSuccessor({ token: storedRefreshToken('some_other_token') })],
              rowCount: 1,
            });

          // The replay is one the window forgives: this session ends, the
          // account's other sessions stay — no revocation, no alarm.
          await expect(refreshAccessToken('burned_token')).rejects.toThrow('INVALID_REFRESH_TOKEN');
          expect(getClient).not.toHaveBeenCalled();
          expect(logger.error).not.toHaveBeenCalledWith(
            expect.stringContaining('SECURITY ALERT'),
            expect.anything()
          );
          expect(logger.warn).toHaveBeenCalledWith(
            'Refresh token replayed within grace window, successor not recoverable',
            expect.objectContaining({ userId: 'user-123', successorTokenId: 'successor-1' })
          );
        });

        test('an unrecoverable successor that was already used still gets the theft verdict', async () => {
          process.env[GRACE_ENV] = '60';

          pool.query
            .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
            .mockResolvedValueOnce({
              rows: [liveSuccessor({
                token: storedRefreshToken('some_other_token'),
                used_at: new Date(Date.now() - 500),
              })],
              rowCount: 1,
            });
          routeClient({ burned: 2 });

          await expect(refreshAccessToken('burned_token')).rejects.toThrow(
            'REFRESH_TOKEN_REUSE_DETECTED'
          );
          expectSessionsRevoked('user-123');
        });

        test('what the successor row holds is never handed out as its token', async () => {
          process.env[GRACE_ENV] = '60';
          // A successor row holding a value in the shape of a token itself, as
          // rows written before hashing did. It is not what a rotation of the
          // replayed token derives, so the replay gets nothing — and no alarm.
          const rawSuccessor = 'c'.repeat(64);

          pool.query
            .mockResolvedValueOnce({ rows: [burnedRow()], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [liveSuccessor({ token: rawSuccessor })], rowCount: 1 });

          await expect(refreshAccessToken('burned_token')).rejects.toThrow('INVALID_REFRESH_TOKEN');
          expect(getClient).not.toHaveBeenCalled();
          expect(logger.error).not.toHaveBeenCalledWith(
            expect.stringContaining('SECURITY ALERT'),
            expect.anything()
          );
        });

        test('a token in the shape of the rows written before hashing is looked up only by its hash', async () => {
          const token = 'b'.repeat(64);
          pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

          await expect(refreshAccessToken(token)).rejects.toThrow('INVALID_REFRESH_TOKEN');
          expect(pool.query.mock.calls[0][1]).toEqual([storedRefreshToken(token)]);
        });

        test('a hash presented as a token is looked up only as a token\'s hash', async () => {
          // What the table holds for a session is not that session's token.
          const stored = storedRefreshToken('d'.repeat(64));
          pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

          await expect(refreshAccessToken(stored)).rejects.toThrow('INVALID_REFRESH_TOKEN');
          expect(pool.query.mock.calls[0][1]).toEqual([storedRefreshToken(stored)]);
        });
      });
    });

  });

  describe('invalidateRefreshToken', () => {
    test('should invalidate refresh token successfully', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await invalidateRefreshToken('token_to_invalidate');

      expect(result).toBe(true);
      // Found by its hash — the only thing the table holds for it
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET used_at'),
        [expect.any(Date), storedRefreshToken('token_to_invalidate')]
      );

      // No piece of the token (30.10.2026): the line has no context at all.
      expect(logger.info).toHaveBeenCalledWith('Refresh token invalidated');
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('token_to_i');
    });

    test('should return false if token already invalidated', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await invalidateRefreshToken('already_used_token');

      expect(result).toBe(false);
    });

    test('a token in the shape of the rows written before hashing is looked up only by its hash', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const token = 'e'.repeat(64);

      await invalidateRefreshToken(token);

      expect(pool.query.mock.calls[0][1]).toEqual([
        expect.any(Date),
        storedRefreshToken(token),
      ]);
    });
  });

  describe('invalidateAllUserTokens', () => {
    test('should invalidate all user tokens — refresh tokens and the access tokens issued until now', async () => {
      routeClient({ burned: 5 });

      const result = await invalidateAllUserTokens('user-123');

      expect(result).toBe(5);
      expectSessionsRevoked('user-123');
      expect(pool.query).not.toHaveBeenCalled();

      expect(logger.warn).toHaveBeenCalledWith(
        'All refresh tokens invalidated for user',
        expect.objectContaining({ userId: 'user-123', tokenCount: 5, accessTokensRevoked: true })
      );
    });

    test('should return 0 if no tokens to invalidate', async () => {
      routeClient({ burned: 0 });

      const result = await invalidateAllUserTokens('user-123');

      expect(result).toBe(0);
      // The access tokens are refused all the same: a session may live on an
      // access token alone for hours after its refresh token was burned.
      expectSessionsRevoked('user-123');
    });

    test('a failure undoes the whole revocation and reaches the caller', async () => {
      mockClient.query.mockImplementation((sql) => (
        sql.startsWith('UPDATE users')
          ? Promise.reject(Object.assign(new Error('connection lost'), { code: '08006' }))
          : Promise.resolve({ rows: [], rowCount: 1 })
      ));

      await expect(invalidateAllUserTokens('user-123')).rejects.toThrow('connection lost');

      expect(clientStatements()).toContain('ROLLBACK');
      expect(clientStatements()).not.toContain('COMMIT');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    test('before migration 035 the refresh tokens still die; the log says the access tokens did not', async () => {
      mockClient.query.mockImplementation((sql) => {
        if (sql.startsWith('UPDATE users')) {
          return Promise.reject(Object.assign(new Error('column "sessions_revoked_at" does not exist'), { code: '42703' }));
        }
        return Promise.resolve({ rows: [], rowCount: sql.startsWith('UPDATE refresh_tokens') ? 2 : 0 });
      });

      await expect(invalidateAllUserTokens('user-123')).resolves.toBe(2);

      expect(clientStatements()).toContain('ROLLBACK TO SAVEPOINT sessions_revoked_at');
      expect(clientStatements()[clientStatements().length - 1]).toBe('COMMIT');
      expect(logger.warn).toHaveBeenCalledWith(
        'All refresh tokens invalidated for user',
        expect.objectContaining({ userId: 'user-123', tokenCount: 2, accessTokensRevoked: false })
      );
    });
  });

  describe('findUserById', () => {
    test('should find user by ID', async () => {
      const mockUser = createMockUser({ id: 'user-123' });

      pool.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1,
      });

      const result = await findUserById('user-123');

      expect(result).toEqual(mockUser);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, email, phone'),
        ['user-123']
      );
    });

    test('should return null if user not found', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await findUserById('nonexistent-user');

      expect(result).toBeNull();
    });

    test('should only return active users', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await findUserById('inactive-user');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_active = true'),
        expect.any(Array)
      );
    });
  });
});
