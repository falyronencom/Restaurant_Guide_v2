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

    // hasNext comes from the envelope, not a default: on the first of two
    // pages it is true, and a `false` there would end the list at 50.
    mockGetFavorites.mockResolvedValue({
      favorites: [row],
      pagination: {
        page: 1,
        limit: 50,
        total: 60,
        pages: 2,
        hasNext: true,
        hasPrevious: false,
      },
    });
    await expect(loadFavorites(1)).resolves.toEqual({
      ok: true,
      favorites: [row],
      page: 1,
      hasNext: true,
    });
  });

  it('maps ApiError to its errorCode', async () => {
    mockGetFavorites.mockRejectedValue(new ApiError(401, 'x', 'NO_SESSION'));
    await expect(loadFavorites()).resolves.toEqual({
      ok: false,
      code: 'NO_SESSION',
    });
  });

  // The real transport throws ApiError(0, 'Fetch failed …') (serverFetch,
  // lib/api/client.ts) — a code-less ApiError like any other, so HTTP_0;
  // NETWORK is only for a throwable that is not an ApiError at all.
  it('maps a code-less ApiError to HTTP_<status> (the transport too) and a non-API throwable to NETWORK', async () => {
    mockGetFavorites.mockRejectedValueOnce(new ApiError(503, 'x'));
    await expect(loadFavorites()).resolves.toEqual({
      ok: false,
      code: 'HTTP_503',
    });
    mockGetFavorites.mockRejectedValueOnce(new ApiError(0, 'Fetch failed'));
    await expect(loadFavorites()).resolves.toEqual({
      ok: false,
      code: 'HTTP_0',
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
  // "Fresh" is the server's echo, not what was typed: the backend stores the
  // name normalized (utils/userName.js — trimmed, inner spaces collapsed) and
  // echoes that. A typed name equal to the echo could not tell them apart.
  const TYPED = '  Новое   имя ';

  it('re-stamps rg_user with the fresh name merged over the existing cookie', async () => {
    mockPutProfileName.mockResolvedValue(AUTH_USER);
    mockGetSessionUser.mockResolvedValue({
      id: 'u1',
      email: 'v@example.by',
      name: 'Старое имя',
      role: 'user',
      avatarUrl: 'https://cdn/avatar.jpg',
    });

    const result = await updateProfile(TYPED);

    const expectedUser = {
      id: 'u1',
      email: 'v@example.by',
      name: 'Новое имя',
      role: 'user',
      avatarUrl: 'https://cdn/avatar.jpg', // preserved from the cookie
    };
    expect(mockPutProfileName).toHaveBeenCalledWith(TYPED);
    expect(mockWriteUser).toHaveBeenCalledWith(expectedUser);
    expect(result).toEqual({ ok: true, user: expectedUser });
  });

  it('builds the display user from the echo when the cookie is missing', async () => {
    // Role and avatar off their defaults: the echo is the only source here.
    mockPutProfileName.mockResolvedValue({
      ...AUTH_USER,
      role: 'partner',
      avatarUrl: 'https://cdn/echo.jpg',
    });
    mockGetSessionUser.mockResolvedValue(null);

    const result = await updateProfile(TYPED);

    const expectedUser = {
      id: 'u1',
      email: 'v@example.by',
      name: 'Новое имя',
      role: 'partner',
      avatarUrl: 'https://cdn/echo.jpg',
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

  it("carries the server's Russian refusal of the name to the form", async () => {
    mockPutProfileName.mockRejectedValue(
      new ApiError(
        400,
        'Имя может содержать только буквы, пробел, дефис и апостроф',
        'VALIDATION_ERROR',
      ),
    );
    await expect(updateProfile('Анна, К.')).resolves.toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Имя может содержать только буквы, пробел, дефис и апостроф',
    });
    expect(mockWriteUser).not.toHaveBeenCalled();
  });
});
