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
});

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

  it('throws NO_SESSION (no backend call) when there are no tokens', async () => {
    mockStore.get.mockReturnValue(undefined);
    await expect(authedFetch('/x')).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'NO_SESSION',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
