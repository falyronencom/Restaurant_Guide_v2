'use server';

import {
  addFavorite,
  checkFavoritesBatch,
  removeFavorite,
  type FavoritesMap,
} from '@/lib/api/endpoints/favorites';
import { ApiError } from '@/lib/api/types';

/*
 * Favorites Server Actions (Phase B Slice 1). State-changing actions are Server
 * Actions for the built-in CSRF defense (DECISION #5). The batch read is also a
 * Server Action: the FavoriteButton islands cannot read the httpOnly access
 * cookie, so the authed batch-check happens server-side here.
 */

const MAX_BATCH = 50; // backend check-batch accepts 1-50 ids

export type FavoriteToggleResult =
  | { ok: true; isFavorite: boolean }
  | { ok: false; code: string };

/**
 * Batch-read favorite state for the visible establishment ids. Returns {} for
 * an unauthenticated visitor (authedFetch throws NO_SESSION with no backend
 * call) or on any read failure — a favorites read must never break the page.
 */
export async function getFavoritesForIds(ids: string[]): Promise<FavoritesMap> {
  if (ids.length === 0) return {};
  if (ids.length > MAX_BATCH) {
    console.warn(
      `[favorites] getFavoritesForIds received ${ids.length} ids; capping at ${MAX_BATCH}. ` +
        'A page rendering >50 cards needs chunking.',
    );
  }
  try {
    return await checkFavoritesBatch(ids.slice(0, MAX_BATCH));
  } catch {
    return {};
  }
}

export async function addFavoriteAction(
  establishmentId: string,
): Promise<FavoriteToggleResult> {
  try {
    await addFavorite(establishmentId);
    return { ok: true, isFavorite: true };
  } catch (err) {
    return { ok: false, code: errorCode(err) };
  }
}

export async function removeFavoriteAction(
  establishmentId: string,
): Promise<FavoriteToggleResult> {
  try {
    await removeFavorite(establishmentId);
    return { ok: true, isFavorite: false };
  } catch (err) {
    return { ok: false, code: errorCode(err) };
  }
}

function errorCode(err: unknown): string {
  if (err instanceof ApiError) return err.errorCode ?? `HTTP_${err.statusCode}`;
  return 'NETWORK';
}
