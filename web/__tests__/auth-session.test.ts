/**
 * Session-establishment + summary Server Actions (auth/actions.ts).
 *
 * Mocks the API-client boundary (serverFetch) and next/headers cookies(); the
 * REAL actions.ts + session.ts nonce/cookie logic runs. Pins the load-bearing
 * security seam: web-tier nonce enforcement, the literal `token` request field,
 * httpOnly cookie issuance, and backend error-code mapping.
 */
import { ApiError } from '@/lib/api/types';

const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
};

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockStore)),
}));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { serverFetch } from '@/lib/api/client';
import {
  establishGoogleSession,
  getSessionSummary,
  prepareLogin,
} from '@/lib/auth/actions';

const mockFetch = serverFetch as jest.Mock;

function makeIdToken(nonce: string): string {
  const payload = Buffer.from(JSON.stringify({ nonce, sub: '123' })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

function makeIdTokenWithoutNonce(): string {
  const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
  return `header.${payload}.signature`;
}

const LOGIN_DATA = {
  user: {
    id: 'u1',
    email: 'a@b.co',
    phone: null,
    name: 'Аня',
    role: 'user',
    authMethod: 'google',
    avatarUrl: null,
    lastLoginAt: null,
  },
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockReturnValue(undefined);
});

describe('establishGoogleSession', () => {
  it('verifies the nonce, exchanges the id_token, and sets httpOnly cookies', async () => {
    const nonce = 'nonce-xyz';
    mockStore.get.mockImplementation((name: string) =>
      name === 'g_nonce' ? { value: nonce } : undefined,
    );
    mockFetch.mockResolvedValue(LOGIN_DATA);

    const idToken = makeIdToken(nonce);
    const result = await establishGoogleSession(idToken);

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({ id: 'u1', name: 'Аня' }),
    });
    // Backend called with the literal `token` field + provider google.
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/auth/oauth',
      expect.objectContaining({
        method: 'POST',
        // JSON only under application/json (server.js, express.json).
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ provider: 'google', token: idToken }),
      }),
      { visitor: null },
    );
    // httpOnly session cookies set (access maxAge = expiresIn; refresh + user).
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_at',
      'access-1',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 14400 }),
    );
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_rt',
      'refresh-1',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_user',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
    // Nonce consumed (single-use).
    expect(mockStore.delete).toHaveBeenCalledWith('g_nonce');
  });

  it('rejects a nonce mismatch WITHOUT calling the backend (login-CSRF defense)', async () => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'g_nonce' ? { value: 'expected-nonce' } : undefined,
    );

    const result = await establishGoogleSession(makeIdToken('attacker-nonce'));

    expect(result).toEqual({
      ok: false,
      code: 'NONCE_MISMATCH',
      message: expect.any(String),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The binding holds only when BOTH halves exist and agree. An id_token with
  // no nonce claim and a jar with no g_nonce cookie are "equal" (both absent)
  // — that must not read as a match.
  it.each<[string, string | undefined, string | null]>([
    ['no cookie, no claim', undefined, null],
    ['no cookie, claim present', undefined, 'n-1'],
    ['cookie present, no claim', 'n-1', null],
    ['empty cookie, empty claim', '', ''],
  ])('rejects without calling the backend: %s', async (_, cookieNonce, claimNonce) => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'g_nonce' && cookieNonce !== undefined ? { value: cookieNonce } : undefined,
    );
    const idToken = claimNonce === null ? makeIdTokenWithoutNonce() : makeIdToken(claimNonce);

    const result = await establishGoogleSession(idToken);

    expect(result).toMatchObject({ ok: false, code: 'NONCE_MISMATCH' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps a backend error code and sets no session cookie', async () => {
    const nonce = 'n1';
    mockStore.get.mockImplementation((name: string) =>
      name === 'g_nonce' ? { value: nonce } : undefined,
    );
    mockFetch.mockRejectedValue(
      new ApiError(403, 'not verified', 'OAUTH_EMAIL_NOT_VERIFIED'),
    );

    const result = await establishGoogleSession(makeIdToken(nonce));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OAUTH_EMAIL_NOT_VERIFIED');
    expect(mockStore.set).not.toHaveBeenCalledWith(
      'rg_at',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('prepareLogin', () => {
  // The nonce is the login-CSRF binding for Google: it must not be
  // predictable, so two logins never share one.
  it('mints a fresh nonce on every call and stores the one it returns', async () => {
    const first = await prepareLogin();
    const second = await prepareLogin();

    expect(first.nonce).not.toBe(second.nonce);
    const stored = mockStore.set.mock.calls
      .filter((c) => c[0] === 'g_nonce')
      .map((c) => c[1]);
    expect(stored).toEqual([first.nonce, second.nonce]);
  });
});

describe('getSessionSummary', () => {
  it('returns the display user from rg_user (read-only — no proactive refresh)', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.co',
      name: 'Аня',
      role: 'user',
      avatarUrl: null,
    };
    // Access cookie absent: getSessionSummary must NOT refresh (refresh is lazy,
    // in authedFetch). It returns the display user from rg_user. The refresh
    // token IS in the jar — without it a proactive refresh would have nothing
    // to present, and «no backend call» below could not fail.
    mockStore.get.mockImplementation((name: string) => {
      if (name === 'rg_user') return { value: JSON.stringify(user) };
      if (name === 'rg_rt') return { value: 'rt-live' };
      return undefined;
    });

    await expect(getSessionSummary()).resolves.toEqual(user);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when there is no session', async () => {
    mockStore.get.mockReturnValue(undefined);
    await expect(getSessionSummary()).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
