/**
 * authedFetch (session.ts) — Bearer injection + transparent refresh-on-401.
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

    await authedFetch('/api/v1/favorites/check-batch', { method: 'POST' });

    const init = mockFetch.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe('Bearer at');
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

    const result = await authedFetch('/api/v1/favorites');

    expect(result).toEqual({ ok: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const retryInit = mockFetch.mock.calls[2][1] as {
      headers: Record<string, string>;
    };
    expect(retryInit.headers.Authorization).toBe('Bearer fresh');
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

  it('throws NO_SESSION (no backend call) when there are no tokens', async () => {
    mockStore.get.mockReturnValue(undefined);
    await expect(authedFetch('/x')).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'NO_SESSION',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
