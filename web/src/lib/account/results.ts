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
  /** `message`: the backend's Russian refusal of the name, shown as is. */
  | { ok: false; code: string; message?: string };

/** May the account be deleted now (brief В1). `refusal.message` is Russian. */
export type AccountDeletionCheckResult =
  | {
      ok: true;
      allowed: boolean;
      refusal: { code: string; message: string } | null;
    }
  | { ok: false; code: string };

/** Delete the account (brief В1): a refusal is its code only (operations). */
export type DeleteAccountResult = { ok: true } | { ok: false; code: string };
