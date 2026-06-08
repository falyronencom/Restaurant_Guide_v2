/**
 * Silent refresh — single-use-rotation safety (session.ts refreshSession).
 *
 * The highest-consequence correctness test in the slice: a missing single-flight
 * guard turns a concurrent multi-tab refresh into REFRESH_TOKEN_REUSE_DETECTED,
 * which invalidates ALL of the user's tokens. The concurrency test asserts the
 * observable invariant — exactly ONE backend refresh under concurrent callers.
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
import { refreshSession } from '@/lib/auth/session';

const mockFetch = serverFetch as jest.Mock;

const REFRESH_DATA = {
  user: { id: 'u1', email: 'a', phone: null, name: 'n', role: 'user' },
  accessToken: 'at2',
  refreshToken: 'rt2',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockImplementation((name: string) =>
    name === 'rg_rt' ? { value: 'rt1' } : undefined,
  );
});

describe('refreshSession', () => {
  it('rotates the token pair and returns the new access token (public route, no Bearer)', async () => {
    mockFetch.mockResolvedValue(REFRESH_DATA);

    const accessToken = await refreshSession();

    expect(accessToken).toBe('at2');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'rt1' }),
      }),
    );
    const init = mockFetch.mock.calls[0][1] as RequestInit & {
      headers?: Record<string, string>;
    };
    expect(init.headers?.Authorization).toBeUndefined();
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_at',
      'at2',
      expect.objectContaining({ maxAge: 14400 }),
    );
    expect(mockStore.set).toHaveBeenCalledWith('rg_rt', 'rt2', expect.anything());
  });

  it('serializes concurrent refreshes of the same token to ONE backend call', async () => {
    let resolveFetch!: (value: unknown) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const p1 = refreshSession();
    const p2 = refreshSession();
    resolveFetch(REFRESH_DATA);
    const [a1, a2] = await Promise.all([p1, p2]);

    expect(a1).toBe('at2');
    expect(a2).toBe('at2');
    expect(mockFetch).toHaveBeenCalledTimes(1); // single-flight dedup
  });

  it('clears the session on reuse-detection (accept-and-recover)', async () => {
    mockFetch.mockRejectedValue(
      new ApiError(403, 'reuse', 'TOKEN_REUSE_DETECTED'),
    );

    const accessToken = await refreshSession();

    expect(accessToken).toBeNull();
    expect(mockStore.delete).toHaveBeenCalledWith('rg_at');
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
    expect(mockStore.delete).toHaveBeenCalledWith('rg_user');
  });

  it('does NOT clear the session on a transient failure (transport / 5xx)', async () => {
    mockFetch.mockRejectedValue(new ApiError(0, 'network down')); // not an auth verdict
    const accessToken = await refreshSession();
    expect(accessToken).toBeNull();
    expect(mockStore.delete).not.toHaveBeenCalled(); // session preserved for retry
  });

  it('returns null without a backend call when no refresh token exists', async () => {
    mockStore.get.mockReturnValue(undefined);
    const accessToken = await refreshSession();
    expect(accessToken).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
