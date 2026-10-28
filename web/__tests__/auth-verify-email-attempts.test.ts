/**
 * verifyEmailCodeAction through the REAL authedFetch (only the transport is
 * stubbed): one entry of the code is one request to the server, so the
 * server's five attempts are five entries. auth-verify-email-action.test.ts
 * stubs authedFetch whole and cannot see a replay.
 *
 * The stub server below keeps the backend's count: a wrong code is 401
 * INVALID_CODE and one attempt per request; the 5th marks the code used and
 * every later request — even with the right code — is 410
 * INVALID_OR_EXPIRED_CODE (backend/src/controllers/authController.js:965-981,
 * services/authService.js:1651-1669).
 */
import { ApiError } from '@/lib/api/types';

const mockStore = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), has: jest.fn() };

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockStore)),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { serverFetch } from '@/lib/api/client';
import { verifyEmailCodeAction } from '@/lib/auth/actions';

const mockFetch = serverFetch as jest.Mock;
const RIGHT_CODE = '654321';
const VERIFY_PATH = '/api/v1/auth/verify-email-code';
const REFRESH_PATH = '/api/v1/auth/refresh';

/** The backend's verify-email-code with its per-request attempt count. */
function stubServer(): void {
  let attempts = 0;
  let codeUsed = false;
  mockFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path === REFRESH_PATH) {
      return Promise.resolve({
        user: { id: 'u1', email: 'a@b.by', phone: null, name: 'n', role: 'user' },
        accessToken: 'at2',
        refreshToken: 'rt2',
        tokenType: 'Bearer',
        expiresIn: 14400,
      });
    }
    if (path !== VERIFY_PATH) return Promise.reject(new Error(`unexpected ${path}`));
    if (codeUsed) {
      return Promise.reject(
        new ApiError(410, 'Verification code is invalid or expired', 'INVALID_OR_EXPIRED_CODE'),
      );
    }
    const { code } = JSON.parse(String(init?.body)) as { code: string };
    if (code !== RIGHT_CODE) {
      attempts += 1;
      if (attempts >= 5) codeUsed = true;
      return Promise.reject(new ApiError(401, 'Verification code is incorrect', 'INVALID_CODE'));
    }
    return Promise.resolve({ user: { id: 'u1', emailVerified: true } });
  });
}

function formDataOf(code: string): FormData {
  const fd = new FormData();
  fd.set('code', code);
  return fd;
}

const verifyCalls = () => mockFetch.mock.calls.filter(([p]) => p === VERIFY_PATH).length;
const refreshCalls = () => mockFetch.mock.calls.filter(([p]) => p === REFRESH_PATH).length;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  // Just registered (or came from the profile): the 4 h access cookie is
  // there, the 15 min code is far younger.
  mockStore.get.mockImplementation((name: string) => {
    if (name === 'rg_at') return { value: 'at-live' };
    if (name === 'rg_rt') return { value: 'rt' };
    return undefined;
  });
  stubServer();
});

it('one wrong entry is one request: no session refresh, no replay', async () => {
  const result = await verifyEmailCodeAction(null, formDataOf('111111'));

  expect(result).toMatchObject({ ok: false, code: 'INVALID_CODE' });
  expect(verifyCalls()).toBe(1);
  expect(refreshCalls()).toBe(0);
});

it('five wrong entries each say "wrong code"; only the sixth says the code is gone', async () => {
  for (let entry = 1; entry <= 5; entry += 1) {
    const result = await verifyEmailCodeAction(null, formDataOf(`11111${entry}`));
    expect({ entry, result }).toMatchObject({
      entry,
      result: {
        ok: false,
        code: 'INVALID_CODE',
        message: 'Неверный код. Проверьте код из письма и попробуйте ещё раз.',
      },
    });
    expect(verifyCalls()).toBe(entry);
  }

  // The server's five attempts are spent; even the right code no longer helps.
  const sixth = await verifyEmailCodeAction(null, formDataOf(RIGHT_CODE));
  expect(sixth).toMatchObject({
    ok: false,
    code: 'INVALID_OR_EXPIRED_CODE',
    message: 'Код неверный или истёк — запросите новый.',
  });
  expect(refreshCalls()).toBe(0);
});

it('the right code after four wrong entries still confirms the email', async () => {
  for (let entry = 1; entry <= 4; entry += 1) {
    await verifyEmailCodeAction(null, formDataOf('000000'));
  }

  await expect(verifyEmailCodeAction(null, formDataOf(RIGHT_CODE))).resolves.toEqual({ ok: true });
  expect(verifyCalls()).toBe(5);
});
