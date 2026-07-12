/**
 * getFavoritesForIds chunking — the backend check-batch window is 1-50 ids;
 * a longer list must be chunked and the maps merged (a /favorites page with
 * «Показать ещё» legally renders >50 hearts, user-ЛК Slice 1). Read failures
 * must still collapse to {} — a favorites read never breaks the page.
 */
jest.mock('@/lib/api/endpoints/favorites', () => ({
  addFavorite: jest.fn(),
  checkFavoritesBatch: jest.fn(),
  getFavorites: jest.fn(),
  removeFavorite: jest.fn(),
}));

import { checkFavoritesBatch } from '@/lib/api/endpoints/favorites';
import { getFavoritesForIds } from '@/lib/favorites/actions';

const mockCheckBatch = checkFavoritesBatch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getFavoritesForIds — batch chunking', () => {
  it('short-circuits an empty list with no backend call', async () => {
    await expect(getFavoritesForIds([])).resolves.toEqual({});
    expect(mockCheckBatch).not.toHaveBeenCalled();
  });

  it('sends a single chunk for ≤50 ids', async () => {
    mockCheckBatch.mockResolvedValue({ 'id-0': true });
    await getFavoritesForIds(['id-0']);
    expect(mockCheckBatch).toHaveBeenCalledTimes(1);
    expect(mockCheckBatch).toHaveBeenCalledWith(['id-0']);
  });

  it('chunks 120 ids into 50/50/20 and merges the maps', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);
    mockCheckBatch.mockImplementation(async (chunk: string[]) =>
      Object.fromEntries(chunk.map((id) => [id, true])),
    );

    const map = await getFavoritesForIds(ids);

    expect(mockCheckBatch).toHaveBeenCalledTimes(3);
    expect(
      mockCheckBatch.mock.calls.map((call) => (call[0] as string[]).length),
    ).toEqual([50, 50, 20]);
    expect(Object.keys(map)).toHaveLength(120);
    expect(map['id-119']).toBe(true);
  });

  it('returns {} when any chunk fails (read must never break the page)', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    mockCheckBatch
      .mockResolvedValueOnce({ 'id-0': true })
      .mockRejectedValueOnce(new Error('boom'));
    await expect(getFavoritesForIds(ids)).resolves.toEqual({});
  });
});
