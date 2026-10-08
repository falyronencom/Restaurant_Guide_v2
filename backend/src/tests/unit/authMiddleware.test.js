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
 */

import { jest } from '@jest/globals';

const getAccountStatus = jest.fn();

jest.unstable_mockModule('../../services/accountStatus.js', () => ({
  getAccountStatus,
  invalidateAccountStatus: jest.fn(),
}));

const { authenticate } = await import('../../middleware/auth.js');
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
