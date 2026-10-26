/**
 * authedFetch (session.ts) — Bearer injection + transparent refresh on the
 * backend sign-in check's 401 (SESSION_REFUSAL_CODES); any other 401 is sent once.
 * The negative invariant (public reads stay anonymous) lives in
 * api-client-transport.test.ts against the real serverFetch.
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
import { authedFetch } from '@/lib/auth/session';

const mockFetch = serverFetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks leaves queued `once` answers in place: one a test did not
  // consume would be handed to the next test.
  mockFetch.mockReset();
});

/** Live-looking session: an access token the backend may refuse + a refresh token. */
function staleAccessWithRefresh() {
  mockStore.get.mockImplementation((name: string) => {
    if (name === 'rg_at') return { value: 'stale' };
    if (name === 'rg_rt') return { value: 'rt' };
    return undefined;
  });
}

describe('authedFetch', () => {
  it('injects Authorization: Bearer from the access cookie', async () => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_at' ? { value: 'at' } : undefined,
    );
    mockFetch.mockResolvedValue({ ok: 1 });

    const body = JSON.stringify({ establishment_ids: ['e1'] });
    await authedFetch('/api/v1/favorites/check-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const init = mockFetch.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe('Bearer at');
    // The caller's request reaches the transport whole — method, body and
    // its own headers next to the Bearer; a dropped init turns every authed
    // write into a body-less GET.
    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('refreshes once and retries with the fresh token on a backend 401', async () => {
    mockStore.get.mockImplementation((name: string) => {
      if (name === 'rg_at') return { value: 'stale' };
      if (name === 'rg_rt') return { value: 'rt' };
      return undefined;
    });
    mockFetch
      .mockRejectedValueOnce(new ApiError(401, 'expired', 'INVALID_TOKEN')) // authed call
      .mockResolvedValueOnce({
        user: { id: 'u1', email: 'a', phone: null, name: 'n', role: 'user' },
        accessToken: 'fresh',
        refreshToken: 'rt2',
        tokenType: 'Bearer',
        expiresIn: 14400,
      }) // refresh
      .mockResolvedValueOnce({ ok: 1 }); // retry

    // A write, so the replay can be seen carrying the same request — headers
    // included: a replay without Content-Type is a body express.json never
    // parses (422 from the validator).
    const body = JSON.stringify({ establishmentId: 'e1' });
    const result = await authedFetch('/api/v1/favorites', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });

    expect(result).toEqual({ ok: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const retryInit = mockFetch.mock.calls[2][1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(retryInit.headers.Authorization).toBe('Bearer fresh');
    expect(retryInit.headers['Content-Type']).toBe('application/json');
    expect(retryInit.method).toBe('POST');
    expect(retryInit.body).toBe(body);
  });

  it('does not loop: a second 401 on the retry re-throws after exactly one refresh', async () => {
    mockStore.get.mockImplementation((name: string) => {
      if (name === 'rg_at') return { value: 'stale' };
      if (name === 'rg_rt') return { value: 'rt' };
      return undefined;
    });
    mockFetch
      .mockRejectedValueOnce(new ApiError(401, 'expired', 'INVALID_TOKEN')) // authed call
      .mockResolvedValueOnce({
        user: {},
        accessToken: 'fresh',
        refreshToken: 'rt2',
        tokenType: 'Bearer',
        expiresIn: 14400,
      }) // refresh
      .mockRejectedValueOnce(new ApiError(401, 'still bad', 'INVALID_TOKEN')); // retry also 401

    await expect(authedFetch('/api/v1/favorites')).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3); // no second refresh — no loop
  });

  it('refreshes at most once on the missing-access path (no double refresh on a follow-up 401)', async () => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_rt' ? { value: 'rt' } : undefined,
    ); // rg_at absent
    mockFetch
      .mockResolvedValueOnce({
        user: {},
        accessToken: 'fresh',
        refreshToken: 'rt2',
        tokenType: 'Bearer',
        expiresIn: 14400,
      }) // upfront refresh
      .mockRejectedValueOnce(new ApiError(401, 'still 401', 'INVALID_TOKEN')); // authed call 401

    await expect(authedFetch('/api/v1/favorites')).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2); // refresh + call; NO second refresh
  });

  // The islands send the user to /login on NO_SESSION and on nothing else. A
  // session the server ended (account switched off, tokens revoked by a
  // password reset or a reuse alarm) refuses the call AND the refresh; the
  // refusal has already cleared the cookies, so anything but NO_SESSION
  // leaves the user on a generic error over a session that no longer exists.
  it.each([
    ['ACCOUNT_INACTIVE', 401, 'ACCOUNT_INACTIVE'],
    ['TOKEN_REVOKED', 401, 'TOKEN_REVOKED'],
    ['TOKEN_REVOKED', 403, 'TOKEN_REUSE_DETECTED'],
  ])(
    'a backend 401 %s whose refresh is refused (%i %s) throws NO_SESSION',
    async (callCode, refreshStatus, refreshCode) => {
      staleAccessWithRefresh();
      mockFetch
        .mockRejectedValueOnce(new ApiError(401, 'refused', callCode)) // authed call
        .mockRejectedValueOnce(new ApiError(refreshStatus, 'refused', refreshCode)); // refresh

      await expect(authedFetch('/api/v1/favorites')).rejects.toMatchObject({
        statusCode: 401,
        errorCode: 'NO_SESSION',
      });
      // A refused refresh is not presented again, and the call is not repeated.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockStore.delete).toHaveBeenCalledWith('rg_at');
      expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
      expect(mockStore.delete).toHaveBeenCalledWith('rg_user');
    },
  );

  it('a backend 401 with no refresh token to try throws NO_SESSION', async () => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_at' ? { value: 'stale' } : undefined,
    ); // rg_rt absent
    mockFetch.mockRejectedValueOnce(new ApiError(401, 'refused', 'TOKEN_REVOKED'));

    await expect(authedFetch('/api/v1/favorites')).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'NO_SESSION',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1); // nothing to present — no refresh call
  });

  // The other side of the line above: a refresh that never got the server's
  // verdict says nothing about the session. The cookies stay, the original
  // error stays, and the next action may still recover — a NO_SESSION here
  // would send a live session to /login.
  it('a backend 401 whose refresh fails transiently keeps the original error and the cookies', async () => {
    staleAccessWithRefresh();
    const original = new ApiError(401, 'refused', 'TOKEN_REVOKED');
    mockFetch
      .mockRejectedValueOnce(original) // authed call
      .mockRejectedValueOnce(new ApiError(503, 'unavailable')) // refresh
      .mockRejectedValueOnce(new ApiError(0, 'timeout')); // the cycle's single retry

    await expect(authedFetch('/api/v1/favorites')).rejects.toBe(original);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockStore.delete).not.toHaveBeenCalled();
  });

  // The same line on the path every action takes after 4 h idle: rg_at lives
  // exactly expiresIn, so it is simply gone and the refresh runs up front.
  it('no access cookie and a refresh that fails transiently: SESSION_REFRESH_UNAVAILABLE, cookies kept', async () => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_rt' ? { value: 'rt' } : undefined,
    ); // rg_at expired out of the jar
    mockFetch
      .mockRejectedValueOnce(new ApiError(503, 'unavailable')) // refresh
      .mockRejectedValueOnce(new ApiError(0, 'timeout')); // the cycle's single retry

    // Not NO_SESSION: that one sends the islands to /login.
    await expect(authedFetch('/api/v1/favorites')).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'SESSION_REFRESH_UNAVAILABLE',
    });
    // Both presentations went to the refresh path; the call itself never ran.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const [path] of mockFetch.mock.calls) {
      expect(path).toBe('/api/v1/auth/refresh');
    }
    expect(mockStore.delete).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'TOKEN_REVOKED'],
    [403, 'TOKEN_REUSE_DETECTED'],
  ])(
    'no access cookie and a refresh the server refuses (%i %s): NO_SESSION, cookies cleared',
    async (refreshStatus, refreshCode) => {
      mockStore.get.mockImplementation((name: string) =>
        name === 'rg_rt' ? { value: 'rt' } : undefined,
      );
      mockFetch.mockRejectedValueOnce(
        new ApiError(refreshStatus, 'refused', refreshCode),
      );

      await expect(authedFetch('/api/v1/favorites')).rejects.toMatchObject({
        statusCode: 401,
        errorCode: 'NO_SESSION',
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // a refusal is not presented again
      expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
    },
  );

  it('throws NO_SESSION (no backend call) when there are no tokens', async () => {
    mockStore.get.mockReturnValue(undefined);
    await expect(authedFetch('/x')).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'NO_SESSION',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Only the server's verdict on the ACCESS token (401) is worth a refresh.
  // Any other refusal is the answer to the request itself: refreshing would
  // spend a single-use refresh token for nothing, and replaying would send a
  // write twice.
  it.each([
    [404, 'NOT_FOUND'],
    [422, 'VALIDATION_ERROR'],
    [429, 'RATE_LIMIT_EXCEEDED'],
    [500, 'INTERNAL_ERROR'],
  ])('a backend %i (%s) is thrown as is: no refresh, no replay', async (status, code) => {
    staleAccessWithRefresh();
    const refusal = new ApiError(status, 'refused', code);
    mockFetch.mockRejectedValueOnce(refusal);

    await expect(
      authedFetch('/api/v1/reviews', { method: 'POST', body: '{}' }),
    ).rejects.toBe(refusal);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/reviews');
  });

  // Every 401 code of the backend's sign-in check (`authenticate`,
  // backend/src/middleware/auth.js — MISSING_TOKEN :53, INVALID_TOKEN_FORMAT
  // :66, INVALID_TOKEN / TOKEN_EXPIRED / MALFORMED_TOKEN :76-84,
  // ACCOUNT_INACTIVE :131, TOKEN_REVOKED :148) is a verdict on the access
  // token: refresh once, replay with the fresh one — one by one, so dropping
  // any of them from the allow-list is seen.
  it.each([
    'MISSING_TOKEN',
    'INVALID_TOKEN_FORMAT',
    'INVALID_TOKEN',
    'TOKEN_EXPIRED',
    'MALFORMED_TOKEN',
    'ACCOUNT_INACTIVE',
    'TOKEN_REVOKED',
  ])('a backend 401 %s from the sign-in check refreshes and replays', async (code) => {
    staleAccessWithRefresh();
    mockFetch
      .mockRejectedValueOnce(new ApiError(401, 'refused', code)) // authed call
      .mockResolvedValueOnce({
        user: { id: 'u1', email: 'a', phone: null, name: 'n', role: 'user' },
        accessToken: 'fresh',
        refreshToken: 'rt2',
        tokenType: 'Bearer',
        expiresIn: 14400,
      }) // refresh
      .mockResolvedValueOnce({ ok: 1 }); // replay

    await expect(authedFetch('/api/v1/favorites')).resolves.toEqual({ ok: 1 });
    expect(mockFetch.mock.calls.map(([p]) => p)).toEqual([
      '/api/v1/favorites',
      '/api/v1/auth/refresh',
      '/api/v1/favorites',
    ]);
    const replayInit = mockFetch.mock.calls[2][1] as { headers: Record<string, string> };
    expect(replayInit.headers.Authorization).toBe('Bearer fresh');
  });

  // A 401 that is the endpoint's own answer is not about the session: the
  // email check answers a wrong code with 401 INVALID_CODE and counts one
  // attempt per REQUEST (backend/src/controllers/authController.js:977-981,
  // services/authService.js:1663-1666) — a replay burned two of the five
  // attempts per wrong entry. A 401 without a code is not the sign-in check's
  // either (all of its refusals carry one) and is sent once as well.
  it.each([
    ['INVALID_CODE', 'INVALID_CODE'],
    ['no code', undefined],
  ])('a backend 401 (%s) that is not the sign-in check is thrown as is: one request, no refresh', async (_label, code) => {
    staleAccessWithRefresh();
    const refusal = new ApiError(401, 'Verification code is incorrect', code);
    mockFetch.mockRejectedValueOnce(refusal);

    await expect(
      authedFetch('/api/v1/auth/verify-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      }),
    ).rejects.toBe(refusal);
    expect(mockFetch.mock.calls.map(([p]) => p)).toEqual(['/api/v1/auth/verify-email-code']);
    expect(mockStore.set).not.toHaveBeenCalled();
    expect(mockStore.delete).not.toHaveBeenCalled();
  });

  /** Holds every refresh until released; answers the authed call by its Bearer. */
  function deferredRefresh(): { release: () => void; refreshCalls: () => number } {
    const waiting: Array<() => void> = [];
    mockFetch.mockImplementation((path: string, init?: { headers?: Record<string, string> }) => {
      if (path === '/api/v1/auth/refresh') {
        return new Promise((resolve) => {
          waiting.push(() =>
            resolve({
              user: { id: 'u1', email: 'a', phone: null, name: 'n', role: 'user' },
              accessToken: 'fresh',
              refreshToken: 'rt2',
              tokenType: 'Bearer',
              expiresIn: 14400,
            }),
          );
        });
      }
      return init?.headers?.Authorization === 'Bearer fresh'
        ? Promise.resolve({ ok: 1 })
        : Promise.reject(new ApiError(401, 'expired', 'TOKEN_EXPIRED'));
    });
    return {
      release: () => waiting.splice(0).forEach((go) => go()),
      refreshCalls: () =>
        mockFetch.mock.calls.filter(([p]) => p === '/api/v1/auth/refresh').length,
    };
  }

  // Two actions of one visitor under one expired access token (e.g. two
  // favourite toggles): the refresh token is single-use, so presenting it
  // twice risks the server's reuse alarm outside its grace window, which
  // revokes every session the visitor has.
  it('two parallel calls refused 401 share ONE refresh, then both replay', async () => {
    staleAccessWithRefresh();
    const gate = deferredRefresh();

    const calls = Promise.all([
      authedFetch('/api/v1/favorites', { method: 'POST', body: '{"a":1}' }),
      authedFetch('/api/v1/favorites', { method: 'POST', body: '{"a":2}' }),
    ]);
    await new Promise((r) => setTimeout(r, 0));
    gate.release();

    await expect(calls).resolves.toEqual([{ ok: 1 }, { ok: 1 }]);
    expect(gate.refreshCalls()).toBe(1);
  });

  it('two parallel calls with no access cookie share ONE up-front refresh', async () => {
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_rt' ? { value: 'rt' } : undefined,
    );
    const gate = deferredRefresh();

    const calls = Promise.all([
      authedFetch('/api/v1/favorites'),
      authedFetch('/api/v1/favorites'),
    ]);
    await new Promise((r) => setTimeout(r, 0));
    gate.release();

    await expect(calls).resolves.toEqual([{ ok: 1 }, { ok: 1 }]);
    expect(gate.refreshCalls()).toBe(1);
  });
});
