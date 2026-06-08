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
import { establishGoogleSession, getSessionSummary } from '@/lib/auth/actions';

const mockFetch = serverFetch as jest.Mock;

function makeIdToken(nonce: string): string {
  const payload = Buffer.from(JSON.stringify({ nonce, sub: '123' })).toString(
    'base64url',
  );
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
        body: JSON.stringify({ provider: 'google', token: idToken }),
      }),
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
    // in authedFetch). It returns the display user from rg_user.
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_user' ? { value: JSON.stringify(user) } : undefined,
    );

    await expect(getSessionSummary()).resolves.toEqual(user);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when there is no session', async () => {
    mockStore.get.mockReturnValue(undefined);
    await expect(getSessionSummary()).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
