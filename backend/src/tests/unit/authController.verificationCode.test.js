/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: the email verification code at registration and on resend
 *
 * Runs the real authController and authService; only the database, the code
 * model, the mail sender, argon2 and jwt are mocked.
 *
 * Registration writes the first code before it responds and leaves only the
 * email running in the background. Until 2026-09-28 the whole send was fired
 * without await: the code write outlived the response, and when it landed
 * after a quick explicit resend the user had two active codes
 * (auth-email-verification flake — the sixth wrong attempt found the second
 * code and answered 401 instead of 410). The cases below park the code write
 * or the email on a promise the test releases by hand.
 */
import { jest } from '@jest/globals';

const mockPool = { query: jest.fn() };

const mockCodeModel = {
  createCode: jest.fn(),
  findActiveCodeForUser: jest.fn(),
  countRecentSends: jest.fn(),
  invalidateActiveCodesForUser: jest.fn(),
  incrementAttempts: jest.fn(),
  markAsUsed: jest.fn(),
};

const mockEmailService = {
  sendVerificationCodeEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule('../../config/database.js', () => ({
  pool: mockPool,
  default: mockPool,
}));
jest.unstable_mockModule('../../models/emailVerificationModel.js', () => mockCodeModel);
jest.unstable_mockModule('../../services/emailService.js', () => mockEmailService);
jest.unstable_mockModule('../../utils/logger.js', () => ({ default: mockLogger }));
jest.unstable_mockModule('argon2', () => ({
  default: { hash: jest.fn(), verify: jest.fn(), argon2id: 0 },
}));
jest.unstable_mockModule('../../utils/jwt.js', () => ({
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
}));

const argon2 = (await import('argon2')).default;
const { generateAccessToken, generateRefreshToken } = await import('../../utils/jwt.js');
const { register, sendVerificationCode } = await import('../../controllers/authController.js');

const USER_ID = 'user-1';
const EMAIL = 'verify@test.com';
const NAME = 'Verify Tester';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const parked = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};

const createRes = () => {
  const res = {};
  res.payload = null;
  res.status = jest.fn(() => res);
  res.json = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });
  return res;
};

const registerReq = () => ({
  body: {
    email: EMAIL,
    password: 'Test123!@#',
    name: NAME,
    authMethod: 'email',
  },
});

// Everything around the code write resolves at once: the user and the refresh
// token are inserted, the verification lookup finds an unverified user.
// resetMocks wipes implementations between tests, so each test re-arranges.
const arrange = () => {
  argon2.hash.mockResolvedValue('argon2-hash');
  generateAccessToken.mockReturnValue('access-token');
  generateRefreshToken.mockReturnValue('refresh-token');
  mockPool.query.mockImplementation((sql) => {
    if (sql.includes('INSERT INTO users')) {
      return Promise.resolve({
        rows: [{
          id: USER_ID,
          email: EMAIL,
          phone: null,
          name: NAME,
          role: 'user',
          auth_method: 'email',
          created_at: new Date(),
        }],
      });
    }
    if (sql.includes('FROM users')) {
      return Promise.resolve({
        rows: [{ id: USER_ID, email: EMAIL, name: NAME, email_verified: false }],
      });
    }
    return Promise.resolve({ rows: [], rowCount: 1 }); // INSERT INTO refresh_tokens
  });
  mockCodeModel.countRecentSends.mockResolvedValue(0);
  mockCodeModel.invalidateActiveCodesForUser.mockResolvedValue(0);
  mockCodeModel.createCode.mockResolvedValue({ id: 'code-1' });
  mockEmailService.sendVerificationCodeEmail.mockResolvedValue({ sent: true });
};

describe('register — the first verification code', () => {
  beforeEach(arrange);

  test('does not respond until the code is written', async () => {
    const write = parked();
    mockCodeModel.createCode.mockReturnValue(write.promise);
    const res = createRes();
    const next = jest.fn();

    const done = register(registerReq(), res, next);
    await flushPromises();

    // The request has reached the code write and is parked on it.
    expect(mockCodeModel.createCode).toHaveBeenCalledWith(
      USER_ID,
      expect.stringMatching(/^\d{6}$/),
      expect.any(Date),
    );
    expect(res.json).not.toHaveBeenCalled();

    write.release({ id: 'code-1' });
    await done;
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.payload.data.user.id).toBe(USER_ID);
    expect(next).not.toHaveBeenCalled();
  });

  test('does not wait for the email', async () => {
    const email = parked();
    mockEmailService.sendVerificationCodeEmail.mockReturnValue(email.promise);
    const res = createRes();

    const done = register(registerReq(), res, jest.fn());
    await flushPromises();

    // Answered while the email is still in flight — carrying the code just written.
    expect(res.status).toHaveBeenCalledWith(201);
    const [, writtenCode] = mockCodeModel.createCode.mock.calls[0];
    expect(mockEmailService.sendVerificationCodeEmail)
      .toHaveBeenCalledWith(EMAIL, writtenCode, NAME);

    email.release({ sent: true });
    await done;
  });

  test('still registers when the code cannot be written', async () => {
    mockCodeModel.createCode.mockRejectedValue(new Error('email_verification_codes unavailable'));
    const res = createRes();
    const next = jest.fn();

    await register(registerReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to issue verification code after registration',
      expect.objectContaining({ userId: USER_ID }),
    );
    expect(mockEmailService.sendVerificationCodeEmail).not.toHaveBeenCalled();
  });

  test('still registers when the email fails, and logs the failure', async () => {
    mockEmailService.sendVerificationCodeEmail.mockRejectedValue(new Error('provider unreachable'));
    const res = createRes();

    await register(registerReq(), res, jest.fn());
    await flushPromises();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to send verification code email',
      expect.objectContaining({ userId: USER_ID, error: 'provider unreachable' }),
    );
  });
});

describe('resend — POST /auth/send-verification-code', () => {
  beforeEach(arrange);

  test('waits for the email and reports whether it was sent', async () => {
    const email = parked();
    mockEmailService.sendVerificationCodeEmail.mockReturnValue(email.promise);
    const res = createRes();

    const done = sendVerificationCode({ user: { userId: USER_ID } }, res, jest.fn());
    await flushPromises();

    // The code is written, the response waits for the provider's verdict.
    expect(mockCodeModel.createCode).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();

    email.release({ sent: false });
    await done;
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.payload.data).toEqual({ sent: false, expiresAt: expect.any(Date) });
  });
});
