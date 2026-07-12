import type {
  AuthUserData,
  FavoriteListItem,
  SessionUser,
} from '@/lib/api/types';

/*
 * Account (user-ЛК Slice 1) operation result envelopes — the same
 * discriminated {ok,…} contract as lib/partner/results (CAT-C-3.14 transport
 * pattern): produced by the server-only operations layer, returned verbatim as
 * JSON by the buffered Route Handlers, consumed by the client fetchers.
 * Client-safe module: types only, no server-only imports.
 */

export type LoadFavoritesResult =
  | {
      ok: true;
      favorites: FavoriteListItem[];
      page: number;
      hasNext: boolean;
    }
  | { ok: false; code: string };

export type LoadProfileResult =
  | { ok: true; profile: AuthUserData }
  | { ok: false; code: string };

export type UpdateProfileResult =
  | { ok: true; user: SessionUser }
  | { ok: false; code: string };
