/**
 * Logout Server Action (auth/actions.ts). Pins the dual-credential backend
 * contract (Bearer header AND {refreshToken} body), the refresh-then-revoke
 * path when access has expired, and the user-protective invariant: cookies are
 * cleared even when the backend call fails.
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
import { logoutAction } from '@/lib/auth/actions';

const mockFetch = serverFetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations: a rejection or a jar left by one
  // test would answer the next.
  mockFetch.mockReset();
  mockStore.set.mockReset();
  mockStore.delete.mockReset();
});

/**
 * A cookie jar with state: what `set` writes, `get` reads back and `delete`
 * removes — so the ORDER of reads relative to the rotation is observable.
 */
function statefulJar(initial: Record<string, string>) {
  const jar = new Map(Object.entries(initial));
  mockStore.get.mockImplementation((name: string) =>
    jar.has(name) ? { value: jar.get(name) } : undefined,
  );
  mockStore.set.mockImplementation((name: string, value: string) => {
    jar.set(name, value);
  });
  mockStore.delete.mockImplementation((name: string) => {
    jar.delete(name);
  });
  return jar;
}

describe('logoutAction', () => {
  it('revokes server-side with BOTH a Bearer header and refreshToken body, then clears cookies', async () => {
    mockStore.get.mockImplementation((name: string) => {
      if (name === 'rg_at') return { value: 'at' };
      if (name === 'rg_rt') return { value: 'rt' };
      return undefined;
    });
    mockFetch.mockResolvedValue({ message: 'ok' });

    await logoutAction();

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'rt' }),
      }),
    );
    const init = mockFetch.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe('Bearer at');
    // JSON only under application/json (server.js, express.json): without
    // it the refresh token in the body is not read and nothing is revoked.
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(mockStore.delete).toHaveBeenCalledWith('rg_at');
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
    expect(mockStore.delete).toHaveBeenCalledWith('rg_user');
  });

  it('clears cookies even when the backend logout fails (best-effort)', async () => {
    mockStore.get.mockImplementation((name: string) => {
      if (name === 'rg_at') return { value: 'at' };
      if (name === 'rg_rt') return { value: 'rt' };
      return undefined;
    });
    mockFetch.mockRejectedValue(new Error('network down'));

    await expect(logoutAction()).resolves.toBeUndefined();
    expect(mockStore.delete).toHaveBeenCalledWith('rg_at');
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
  });

  it('refreshes first, then revokes server-side, when the access token has expired', async () => {
    // Stateful: the refresh rotates rt → rt2 in the jar. 'rt' is spent the
    // moment it is presented; the token to revoke is the one the session now
    // holds (single-use rotation).
    statefulJar({ rg_rt: 'rt' });
    mockFetch
      .mockResolvedValueOnce({
        user: { id: 'u1', email: 'a', phone: null, name: 'n', role: 'user' },
        accessToken: 'at2',
        refreshToken: 'rt2',
        tokenType: 'Bearer',
        expiresIn: 14400,
      }) // refresh
      .mockResolvedValueOnce({ message: 'ok' }); // logout

    await logoutAction();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/auth/refresh');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/v1/auth/logout');
    const logoutInit = mockFetch.mock.calls[1][1] as {
      headers: Record<string, string>;
    };
    expect(logoutInit.headers.Authorization).toBe('Bearer at2');
    expect((logoutInit as unknown as { body: string }).body).toBe(
      JSON.stringify({ refreshToken: 'rt2' }),
    );
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
  });

  // A refresh that got no verdict (5xx, transport) leaves the refresh token
  // alive — so the local logout is all that ends the session in this browser
  // (a shared computer), and it must still happen.
  it.each([
    ['503', new ApiError(503, 'unavailable')],
    ['transport', new ApiError(0, 'fetch failed')],
  ])('clears cookies when access is expired and the refresh fails without a verdict (%s)', async (_, failure) => {
    const jar = statefulJar({ rg_rt: 'rt', rg_user: '{"id":"u1"}' });
    mockFetch.mockRejectedValue(failure); // the refresh and its single retry

    await expect(logoutAction()).resolves.toBeUndefined();

    // No Bearer could be minted, so no server-side revocation was attempted…
    expect(mockFetch.mock.calls.every(([p]) => p !== '/api/v1/auth/logout')).toBe(true);
    // …and the local logout still ran.
    expect(jar.has('rg_rt')).toBe(false);
    expect(jar.has('rg_user')).toBe(false);
  });

  it('clears cookies locally when access is expired and the refresh also fails', async () => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_rt' ? { value: 'rt' } : undefined,
    );
    mockFetch.mockRejectedValue(
      new ApiError(403, 'reuse', 'TOKEN_REUSE_DETECTED'),
    ); // refresh fails → no valid bearer → no logout POST

    await expect(logoutAction()).resolves.toBeUndefined();

    expect(
      mockFetch.mock.calls.every((c) => c[0] !== '/api/v1/auth/logout'),
    ).toBe(true);
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
  });
});
