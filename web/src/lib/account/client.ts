import type {
  LoadFavoritesResult,
  LoadProfileResult,
  UpdateProfileResult,
} from '@/lib/account/results';

/*
 * Account client fetchers — browser side of the user-ЛК transport, mirroring
 * lib/partner/client (CAT-C-3.14). Each POSTs same-origin to a buffered Route
 * Handler (app/api/account/*): the httpOnly session cookies ride the
 * same-origin fetch automatically, the handler enforces the same-origin CSRF
 * guard, and the {ok,…} envelope comes back verbatim (including the 403 CSRF
 * rejection). A transport failure maps to NETWORK so callers always branch on
 * `r.ok`.
 */

const BASE = '/api/account';

async function postAccount<T extends { ok: boolean }>(
  path: string,
  body?: unknown,
): Promise<T | { ok: false; code: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      ...(body !== undefined
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
    return (await res.json()) as T;
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
}

export function loadFavorites(page = 1): Promise<LoadFavoritesResult> {
  return postAccount<LoadFavoritesResult>(`${BASE}/favorites/list`, { page });
}

export function loadProfile(): Promise<LoadProfileResult> {
  return postAccount<LoadProfileResult>(`${BASE}/profile/load`);
}

export function updateProfileAction(name: string): Promise<UpdateProfileResult> {
  return postAccount<UpdateProfileResult>(`${BASE}/profile/update`, { name });
}
