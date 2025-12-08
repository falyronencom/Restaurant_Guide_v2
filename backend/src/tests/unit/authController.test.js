import { jest } from '@jest/globals';

const mockAuthService = {
  createUser: jest.fn(),
  generateTokenPair: jest.fn(),
  verifyCredentials: jest.fn(),
  refreshAccessToken: jest.fn(),
  invalidateRefreshToken: jest.fn(),
  invalidateAllUserTokens: jest.fn(),
  findUserById: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../services/authService.js', () => mockAuthService);
jest.unstable_mockModule('../../utils/logger.js', () => ({ default: mockLogger }));

const { register, refresh, logout, getCurrentUser } = await import('../../controllers/authController.js');

const createRes = () => {
  const res = {};
  res.statusCode = null;
  res.payload = null;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });
  return res;
};

describe('authController guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('register returns 400 when email and phone missing', async () => {
    const req = { body: { password: 'Password123!', name: 'Test User' } };
    const res = createRes();
    const next = jest.fn();

    await register(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(next).not.toHaveBeenCalled();
  });

  test('refresh returns 400 when refreshToken missing', async () => {
    const req = { body: {} };
    const res = createRes();
    const next = jest.fn();

    await refresh(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(next).not.toHaveBeenCalled();
  });

  test('logout returns 400 when refreshToken missing', async () => {
    const req = { body: {}, user: { userId: 'user-1' } };
    const res = createRes();
    const next = jest.fn();

    await logout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(next).not.toHaveBeenCalled();
  });

  test('logout forwards errors from service', async () => {
    const req = { body: { refreshToken: 'token' }, user: { userId: 'user-1' } };
    const res = createRes();
    const next = jest.fn();
    mockAuthService.invalidateRefreshToken.mockRejectedValueOnce(new Error('db_failed'));

    await logout(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('getCurrentUser handles service errors', async () => {
    const req = { user: { userId: 'user-1' } };
    const res = createRes();
    const next = jest.fn();
    mockAuthService.findUserById.mockRejectedValueOnce(new Error('query_failed'));

    await getCurrentUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

