/**
 * Favorites endpoint encoders (endpoints/favorites.ts) — pins the load-bearing
 * casing traps that produce a SILENT 422 on mismatch: check-batch snake_case
 * `establishment_ids`, ADD camelCase `establishmentId`, DELETE encoded path
 * param. Mocks authedFetch (the session boundary) and asserts the exact request
 * shape every encoder sends.
 */
jest.mock('@/lib/auth/session', () => ({ authedFetch: jest.fn() }));

import { authedFetch } from '@/lib/auth/session';
import {
  addFavorite,
  checkFavoritesBatch,
  getFavorites,
  removeFavorite,
} from '@/lib/api/endpoints/favorites';

const mockAuthedFetch = authedFetch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthedFetch.mockResolvedValue({});
});

describe('favorites endpoint encoders — casing/shape contract', () => {
  it('check-batch sends snake_case establishment_ids', async () => {
    mockAuthedFetch.mockResolvedValue({ favorites: { e1: true } });
    await checkFavoritesBatch(['e1', 'e2']);
    expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/favorites/check-batch',
      expect.objectContaining({
        method: 'POST',
        // JSON only under application/json (server.js, express.json) —
        // without it the ids never reach the backend: the silent 422.
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ establishment_ids: ['e1', 'e2'] }),
      }),
    );
  });

  // The batch answer is what paints the hearts after a page load: the map
  // comes from data.favorites (backend favoriteService
  // .checkMultipleFavoriteStatus returns { favorites: { <id>: boolean } }).
  it('check-batch returns the server map of saved ids, and {} when the field is absent', async () => {
    mockAuthedFetch.mockResolvedValueOnce({ favorites: { e1: true, e2: false } });
    await expect(checkFavoritesBatch(['e1', 'e2'])).resolves.toEqual({
      e1: true,
      e2: false,
    });

    mockAuthedFetch.mockResolvedValueOnce({});
    await expect(checkFavoritesBatch(['e3'])).resolves.toEqual({});
  });

  it('check-batch short-circuits an empty id list with no backend call', async () => {
    await checkFavoritesBatch([]);
    expect(mockAuthedFetch).not.toHaveBeenCalled();
  });

  it('ADD sends camelCase establishmentId', async () => {
    await addFavorite('e1');
    expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/favorites',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ establishmentId: 'e1' }),
      }),
    );
  });

  it('REMOVE uses an encoded path param with no body', async () => {
    await removeFavorite('a/b');
    expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/favorites/a%2Fb',
      expect.objectContaining({ method: 'DELETE' }),
    );
    const init = mockAuthedFetch.mock.calls[0][1] as { body?: unknown };
    expect(init.body).toBeUndefined();
  });

  it('LIST is a GET with page/limit in the query string and no body', async () => {
    mockAuthedFetch.mockResolvedValue({ favorites: [], pagination: {} });
    await getFavorites();
    expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/favorites?page=1&limit=50',
    );
  });

  it('LIST forwards explicit page/limit', async () => {
    mockAuthedFetch.mockResolvedValue({ favorites: [], pagination: {} });
    await getFavorites({ page: 3, limit: 20 });
    expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/favorites?page=3&limit=20',
    );
  });

  it('LIST returns the envelope data verbatim (flat establishment_* rows)', async () => {
    const data = {
      favorites: [{ id: 'f1', establishment_slug: 'cafe-x' }],
      pagination: { page: 1, hasNext: false },
    };
    mockAuthedFetch.mockResolvedValue(data);
    await expect(getFavorites()).resolves.toBe(data);
  });

  it('never includes a user_id key in any payload (JWT-derived invariant)', async () => {
    mockAuthedFetch.mockResolvedValue({ favorites: [], pagination: {} });
    await checkFavoritesBatch(['e1']);
    await addFavorite('e1');
    await getFavorites();
    for (const call of mockAuthedFetch.mock.calls) {
      const init = call[1] as { body?: string } | undefined;
      expect(init?.body ?? '').not.toMatch(/user_?id/i);
    }
  });
});
