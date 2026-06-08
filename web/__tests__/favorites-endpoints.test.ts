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
        body: JSON.stringify({ establishment_ids: ['e1', 'e2'] }),
      }),
    );
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

  it('never includes a user_id key in any payload (JWT-derived invariant)', async () => {
    await checkFavoritesBatch(['e1']);
    await addFavorite('e1');
    for (const call of mockAuthedFetch.mock.calls) {
      const init = call[1] as { body?: string } | undefined;
      expect(init?.body ?? '').not.toMatch(/user_?id/i);
    }
  });
});
