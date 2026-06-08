import 'server-only';

import { authedFetch } from '@/lib/auth/session';

/*
 * Favorites — authenticated typed endpoint functions over /api/v1/favorites/*.
 *
 * All endpoints are Bearer-gated; user_id is derived server-side from the JWT
 * and must NEVER be sent in a payload.
 *
 * Casing traps (verified against backend validators — silent 422 on mismatch):
 *   ADD          → POST /api/v1/favorites          body { establishmentId }   (camelCase)
 *   CHECK-BATCH  → POST /api/v1/favorites/check-batch body { establishment_ids } (snake_case, 1-50)
 *   REMOVE       → DELETE /api/v1/favorites/:establishmentId  (path param, no body)
 */

/** check-batch returns a MAP with an explicit boolean for EVERY requested id: { "<uuid>": true | false }. A missing id reads as false either way. */
export type FavoritesMap = Record<string, boolean>;

export async function checkFavoritesBatch(
  establishmentIds: string[],
): Promise<FavoritesMap> {
  if (establishmentIds.length === 0) return {};
  const data = await authedFetch<{ favorites: FavoritesMap }>(
    '/api/v1/favorites/check-batch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // snake_case `establishment_ids` — backend validator rejects camelCase here.
      body: JSON.stringify({ establishment_ids: establishmentIds }),
    },
  );
  return data.favorites ?? {};
}

export async function addFavorite(establishmentId: string): Promise<void> {
  await authedFetch('/api/v1/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // camelCase `establishmentId` — backend validator rejects snake_case here.
    body: JSON.stringify({ establishmentId }),
  });
}

export async function removeFavorite(establishmentId: string): Promise<void> {
  await authedFetch(`/api/v1/favorites/${encodeURIComponent(establishmentId)}`, {
    method: 'DELETE',
  });
}
