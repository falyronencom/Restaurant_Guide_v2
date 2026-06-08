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
});

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
    mockStore.get.mockImplementation((name: string) =>
      name === 'rg_rt' ? { value: 'rt' } : undefined,
    );
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
    expect(mockStore.delete).toHaveBeenCalledWith('rg_rt');
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
