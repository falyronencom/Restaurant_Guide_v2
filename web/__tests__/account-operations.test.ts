/**
 * Account operations (lib/account/operations) — envelope mapping over the
 * endpoint layer: ApiError → its errorCode (HTTP_n fallback), transport →
 * NETWORK; updateProfile re-stamps the rg_user display cookie with the fresh
 * name MERGED over the existing cookie (avatarUrl preserved — /auth/profile's
 * echo is authoritative for name only, mirroring the refreshSession re-stamp).
 */
jest.mock('@/lib/api/endpoints/favorites', () => ({ getFavorites: jest.fn() }));
jest.mock('@/lib/api/endpoints/profile', () => ({
  getMe: jest.fn(),
  putProfileName: jest.fn(),
}));
jest.mock('@/lib/auth/session', () => ({
  getSessionUser: jest.fn(),
  writeUser: jest.fn(),
}));

import { getFavorites } from '@/lib/api/endpoints/favorites';
import { getMe, putProfileName } from '@/lib/api/endpoints/profile';
import { ApiError, type AuthUserData } from '@/lib/api/types';
import {
  loadFavorites,
  loadProfile,
  updateProfile,
} from '@/lib/account/operations';
import { getSessionUser, writeUser } from '@/lib/auth/session';

const mockGetFavorites = getFavorites as jest.Mock;
const mockGetMe = getMe as jest.Mock;
const mockPutProfileName = putProfileName as jest.Mock;
const mockGetSessionUser = getSessionUser as jest.Mock;
const mockWriteUser = writeUser as jest.Mock;

const AUTH_USER: AuthUserData = {
  id: 'u1',
  email: 'v@example.by',
  phone: null,
  name: 'Новое имя',
  role: 'user',
  authMethod: 'email',
  avatarUrl: null,
  emailVerified: true,
  phoneVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadFavorites', () => {
  it('maps the wire envelope to {favorites, page, hasNext} at limit 50', async () => {
    const row = { id: 'f1', establishment_id: 'e1' };
    mockGetFavorites.mockResolvedValue({
      favorites: [row],
      pagination: {
        page: 2,
        limit: 50,
        total: 60,
        pages: 2,
        hasNext: false,
        hasPrevious: true,
      },
    });

    await expect(loadFavorites(2)).resolves.toEqual({
      ok: true,
      favorites: [row],
      page: 2,
      hasNext: false,
    });
    expect(mockGetFavorites).toHaveBeenCalledWith({ page: 2, limit: 50 });
  });

  it('maps ApiError to its errorCode', async () => {
    mockGetFavorites.mockRejectedValue(new ApiError(401, 'x', 'NO_SESSION'));
    await expect(loadFavorites()).resolves.toEqual({
      ok: false,
      code: 'NO_SESSION',
    });
  });

  it('maps a code-less ApiError to HTTP_<status> and transport to NETWORK', async () => {
    mockGetFavorites.mockRejectedValueOnce(new ApiError(503, 'x'));
    await expect(loadFavorites()).resolves.toEqual({
      ok: false,
      code: 'HTTP_503',
    });
    mockGetFavorites.mockRejectedValueOnce(new Error('boom'));
    await expect(loadFavorites()).resolves.toEqual({
      ok: false,
      code: 'NETWORK',
    });
  });
});

describe('loadProfile', () => {
  it('returns the fresh /auth/me user', async () => {
    mockGetMe.mockResolvedValue(AUTH_USER);
    await expect(loadProfile()).resolves.toEqual({
      ok: true,
      profile: AUTH_USER,
    });
  });

  it('maps errors to codes', async () => {
    mockGetMe.mockRejectedValue(new ApiError(401, 'x', 'NO_SESSION'));
    await expect(loadProfile()).resolves.toEqual({
      ok: false,
      code: 'NO_SESSION',
    });
  });
});

describe('updateProfile', () => {
  it('re-stamps rg_user with the fresh name merged over the existing cookie', async () => {
    mockPutProfileName.mockResolvedValue(AUTH_USER);
    mockGetSessionUser.mockResolvedValue({
      id: 'u1',
      email: 'v@example.by',
      name: 'Старое имя',
      role: 'user',
      avatarUrl: 'https://cdn/avatar.jpg',
    });

    const result = await updateProfile('Новое имя');

    const expectedUser = {
      id: 'u1',
      email: 'v@example.by',
      name: 'Новое имя',
      role: 'user',
      avatarUrl: 'https://cdn/avatar.jpg', // preserved from the cookie
    };
    expect(mockPutProfileName).toHaveBeenCalledWith('Новое имя');
    expect(mockWriteUser).toHaveBeenCalledWith(expectedUser);
    expect(result).toEqual({ ok: true, user: expectedUser });
  });

  it('builds the display user from the echo when the cookie is missing', async () => {
    mockPutProfileName.mockResolvedValue(AUTH_USER);
    mockGetSessionUser.mockResolvedValue(null);

    const result = await updateProfile('Новое имя');

    const expectedUser = {
      id: 'u1',
      email: 'v@example.by',
      name: 'Новое имя',
      role: 'user',
      avatarUrl: null,
    };
    expect(mockWriteUser).toHaveBeenCalledWith(expectedUser);
    expect(result).toEqual({ ok: true, user: expectedUser });
  });

  it('maps errors to codes and does NOT touch the cookie', async () => {
    mockPutProfileName.mockRejectedValue(
      new ApiError(400, 'x', 'VALIDATION_ERROR'),
    );
    await expect(updateProfile('')).resolves.toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(mockWriteUser).not.toHaveBeenCalled();
  });
});
