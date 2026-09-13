/**
 * Silent refresh — single-use-rotation safety (session.ts refreshSession).
 *
 * The highest-consequence correctness test in the slice: a missing single-flight
 * guard turns a concurrent multi-tab refresh into REFRESH_TOKEN_REUSE_DETECTED,
 * which invalidates ALL of the user's tokens. The concurrency test asserts the
 * observable invariant — exactly ONE backend refresh under concurrent callers.
 *
 * Second fact guarded here since backend `5ede30c` opened the reuse grace
 * window (SDL CAT-D-2.1): the cycle presents the refresh token TWICE on a
 * transient failure and never more, and never at all once the server has
 * judged the token itself. The counts below are the fact, not decoration —
 * every extra presentation is one more chance to land outside the window and
 * collect a revocation of every session the user has.
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
  // clearAllMocks wipes call records but NOT queued `once` implementations: a
  // test whose last queued answer goes unconsumed would hand it to the next
  // test, which would then be asserting against someone else's mock.
  mockFetch.mockReset();
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

  // -------------------------------------------------------------------------
  // The cycle's single retry (grace window, backend `5ede30c` / SDL CAT-D-2.1)
  // -------------------------------------------------------------------------

  it('retries ONCE on a transient failure, and the retry carries the cycle', async () => {
    mockFetch
      .mockRejectedValueOnce(new ApiError(0, 'socket hang up')) // no verdict reached
      .mockResolvedValueOnce(REFRESH_DATA); // second presentation, inside the window

    const accessToken = await refreshSession();

    // The caller gets its answer instead of the refusal it used to get over a
    // refresh token that was never actually spent.
    expect(accessToken).toBe('at2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/auth/refresh',
      '/api/v1/auth/refresh',
    ]);
    // BOTH presentations carry the same token — that identity is the whole
    // premise of the backend's window (same token in → same successor out).
    for (const call of mockFetch.mock.calls) {
      expect((call[1] as RequestInit).body).toBe(
        JSON.stringify({ refreshToken: 'rt1' }),
      );
    }
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_at',
      'at2',
      expect.anything(),
    );
  });

  it.each([
    [401, 'INVALID_TOKEN'],
    [403, 'TOKEN_REUSE_DETECTED'],
  ])(
    'does NOT retry a %i: the server judged the token itself, a second presentation would only repeat the refusal',
    async (statusCode, errorCode) => {
      mockFetch.mockRejectedValue(
        new ApiError(statusCode as number, 'rejected', errorCode as string),
      );

      const accessToken = await refreshSession();

      expect(accessToken).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1); // one presentation, no retry
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/auth/refresh',
        expect.anything(),
      );
      expect(mockStore.delete).toHaveBeenCalledWith('rg_rt'); // session buried
    },
  );

  it('stops after the retry: a second transient failure buys no third attempt', async () => {
    mockFetch
      .mockRejectedValueOnce(new ApiError(0, 'socket hang up'))
      .mockRejectedValueOnce(new ApiError(503, 'bad gateway'))
      .mockResolvedValue(REFRESH_DATA); // a third attempt would collect THIS

    const accessToken = await refreshSession();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(accessToken).toBeNull(); // null, i.e. the token above was never collected
  });

  it("the retry's verdict replaces the first: transient, then reuse-detection buries the session", async () => {
    // The realistic shape of a lost answer: the first request DID arrive and
    // rotate, its answer was lost, and the retry landed past the window.
    mockFetch
      .mockRejectedValueOnce(new ApiError(0, 'socket hang up')) // no verdict
      .mockRejectedValueOnce(
        new ApiError(403, 'reuse', 'TOKEN_REUSE_DETECTED'),
      ); // verdict

    const accessToken = await refreshSession();

    expect(accessToken).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Cleared on the SECOND verdict — a transient first attempt does not make
    // the cycle forget that the session ended up judged dead.
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
  });
});
