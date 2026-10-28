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
        // JSON only under application/json (server.js, express.json): a
        // body-less refresh is a 422, read as transient — the session never
        // renews.
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ refreshToken: 'rt1' }),
      }),
      { visitor: null },
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

  it('keeps two different refresh tokens apart: each is presented, each caller gets its own access token', async () => {
    // Two visitors refreshing on one server instance at once. The in-flight
    // map is shared by the process; the refresh token is the only thing that
    // tells the two apart.
    const reads = ['rt-anna', 'rt-boris'];
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_rt' ? { value: reads.shift() ?? 'rt-late' } : undefined,
    );
    const pending: Array<(v: unknown) => void> = [];
    mockFetch.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );

    const pAnna = refreshSession();
    const pBoris = refreshSession();
    // Let both callers reach the transport before anyone answers.
    await new Promise((r) => setTimeout(r, 0));

    try {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const presented = mockFetch.mock.calls.map(
        ([, init]) => JSON.parse((init as { body: string }).body).refreshToken,
      );
      expect(presented.sort()).toEqual(['rt-anna', 'rt-boris']);
    } finally {
      // Answer each presentation with that visitor's own pair — also when an
      // assertion above failed, so no in-flight entry outlives this test.
      mockFetch.mock.calls.forEach(([, init], i) => {
        const token = JSON.parse((init as { body: string }).body).refreshToken;
        const who = token === 'rt-anna' ? 'anna' : 'boris';
        pending[i]({ ...REFRESH_DATA, accessToken: `at-${who}`, refreshToken: `rt2-${who}` });
      });
    }
    expect(await pAnna).toBe('at-anna');
    expect(await pBoris).toBe('at-boris');
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

  // Transient is every failure that is not an auth verdict (session.ts lists
  // transport, 5xx and 429): the refresh route answers 429 under its limiter,
  // and wiping the session there would log people out under load.
  it.each([
    ['transport', new ApiError(0, 'network down')],
    ['5xx', new ApiError(503, 'unavailable')],
    ['429', new ApiError(429, 'Too many requests', 'RATE_LIMIT_EXCEEDED')],
  ])('does NOT clear the session on a transient failure (%s)', async (_kind, err) => {
    mockFetch.mockRejectedValue(err); // not an auth verdict
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
