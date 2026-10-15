/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: middleware/auth.js authenticate — what it does with the account
 * status (services/accountStatus.js, mocked here).
 *
 * The integration suite (account-status.test.js) covers the database path.
 * What it cannot arrange is the database failing in the middle of the check:
 * that must be a 503 the clients retry, never a 401 — on a 401 every client
 * refreshes, and a refresh that also fails signs the user out.
 *
 * issuedBeforeRevocation is mocked too: here it is the middleware's use of the
 * verdict that is checked — what it is asked and what it does with the
 * answer. The rule itself, boundary included, is accountStatus.test.js and
 * session-revocation.test.js.
 *
 * authorize: the 403 a role the route does not admit gets — its text is a
 * literal here.
 */

import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const getAccountStatus = jest.fn();
const issuedBeforeRevocation = jest.fn();

jest.unstable_mockModule('../../services/accountStatus.js', () => ({
  getAccountStatus,
  issuedBeforeRevocation,
  invalidateAccountStatus: jest.fn(),
}));

const { authenticate, authorize } = await import('../../middleware/auth.js');
const { generateAccessToken } = await import('../../utils/jwt.js');

const USER_ID = '7a1d2c3b-0000-4000-8000-000000000001';

const callAuthenticate = async (authorization) => {
  const req = { headers: { authorization }, ip: '127.0.0.1' };
  const res = {
    status: jest.fn(function status() { return this; }),
    json: jest.fn(function json() { return this; }),
  };
  const next = jest.fn();
  await authenticate(req, res, next);
  return { req, res, next };
};

const tokenFor = (role) => `Bearer ${generateAccessToken({ userId: USER_ID, email: 'a@test.com', role })}`;

describe('authenticate — the account behind the token', () => {
  test('the database failing during the check is a 503 passed on, not a 401', async () => {
    getAccountStatus.mockRejectedValue(new Error('connection refused'));

    const { res, next } = await callAuthenticate(tokenFor('user'));

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const [error] = next.mock.calls[0];
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('AUTH_CHECK_UNAVAILABLE');
  });

  test.each([
    ['switched off', { isActive: false, role: 'user' }],
    ['missing', null],
  ])('an account that is %s gets 401 ACCOUNT_INACTIVE', async (_label, status) => {
    getAccountStatus.mockResolvedValue(status);

    const { res, next } = await callAuthenticate(tokenFor('user'));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.code).toBe('ACCOUNT_INACTIVE');
  });

  test('the role comes from the database, not from the token', async () => {
    getAccountStatus.mockResolvedValue({ isActive: true, role: 'user' });

    const { req, next } = await callAuthenticate(tokenFor('admin'));

    expect(next).toHaveBeenCalledWith();
    expect(getAccountStatus).toHaveBeenCalledWith(USER_ID);
    expect(req.user).toEqual({ userId: USER_ID, email: 'a@test.com', role: 'user' });
  });

  test('a token that does not verify is refused before the database is asked', async () => {
    const { res } = await callAuthenticate('Bearer not-a-token');

    expect(res.status).toHaveBeenCalledWith(401);
    expect(getAccountStatus).not.toHaveBeenCalled();
  });
});

describe('authenticate — a token issued before the account sessions were revoked', () => {
  const REVOKED_AT = new Date('2026-10-12T09:00:00.000Z');

  test('is refused with 401 TOKEN_REVOKED, the rule asked about this token and this stamp', async () => {
    getAccountStatus.mockResolvedValue({ isActive: true, role: 'user', sessionsRevokedAt: REVOKED_AT });
    issuedBeforeRevocation.mockReturnValue(true);
    const authorization = tokenFor('user');
    const { iatMs } = jwt.decode(authorization.slice('Bearer '.length));

    const { req, res, next } = await callAuthenticate(authorization);

    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.code).toBe('TOKEN_REVOKED');
    // The issue time in milliseconds, not the whole-second iat.
    expect(Number.isSafeInteger(iatMs)).toBe(true);
    expect(issuedBeforeRevocation).toHaveBeenCalledWith(iatMs, REVOKED_AT);
  });

  test('is let through when the rule says it was issued after', async () => {
    getAccountStatus.mockResolvedValue({ isActive: true, role: 'partner', sessionsRevokedAt: REVOKED_AT });
    issuedBeforeRevocation.mockReturnValue(false);

    const { req, next } = await callAuthenticate(tokenFor('user'));

    expect(next).toHaveBeenCalledWith();
    expect(req.user.role).toBe('partner');
  });

  test('a switched-off account is answered ACCOUNT_INACTIVE whatever its tokens', async () => {
    getAccountStatus.mockResolvedValue({ isActive: false, role: 'user', sessionsRevokedAt: REVOKED_AT });
    issuedBeforeRevocation.mockReturnValue(true);

    const { res } = await callAuthenticate(tokenFor('user'));

    expect(res.json.mock.calls[0][0].error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('authorize — a role the route does not admit', () => {
  const callAuthorize = (allowedRoles, role) => {
    const req = { user: { userId: USER_ID, role }, path: '/api/v1/partner/establishments' };
    const res = {
      status: jest.fn(function status() { return this; }),
      json: jest.fn(function json() { return this; }),
    };
    const next = jest.fn();
    authorize(allowedRoles)(req, res, next);
    return { res, next };
  };

  test('is refused 403 FORBIDDEN with the Russian text the app shows as is', () => {
    // Say a partner role taken away mid-session: the role comes from the
    // database on every request. Text: decision of the Coordinator, 15.10.2026.
    const { res, next } = callAuthorize(['partner'], 'user');

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toEqual({
      success: false,
      message: 'Недостаточно прав для этого действия.',
      error: {
        code: 'FORBIDDEN',
        details: { required_roles: ['partner'], your_role: 'user' },
      },
      timestamp: expect.any(String),
    });
  });

  test('a role the route admits passes', () => {
    const { res, next } = callAuthorize(['partner', 'admin'], 'admin');

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
