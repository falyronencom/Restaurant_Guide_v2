import 'server-only';

import { getFavorites } from '@/lib/api/endpoints/favorites';
import {
  deleteOwnAccount,
  getAccountDeletionCheck,
  getMe,
  putProfileName,
} from '@/lib/api/endpoints/profile';
import { personText } from '@/lib/api/person-text';
import { ApiError } from '@/lib/api/types';
import { clearSession, getSessionUser, writeUser } from '@/lib/auth/session';
import type {
  AccountDeletionCheckResult,
  DeleteAccountResult,
  LoadFavoritesResult,
  LoadProfileResult,
  UpdateProfileResult,
} from '@/lib/account/results';

/*
 * Account (user-ЛК Slice 1) operations — plain server-only async functions
 * returning discriminated {ok,…} envelopes, invoked from buffered POST Route
 * Handlers (app/api/account/*) on the cabinet transport pattern (CAT-C-3.14):
 * the Railway edge 503s streamed transports, buffered JSON is immune. Cookie
 * writes are legal here (Route Handler context): authedFetch may rotate the
 * single-use refresh cookie, and the profile update re-stamps rg_user.
 */

function codeFromError(err: unknown): string {
  if (err instanceof ApiError) return err.errorCode ?? `HTTP_${err.statusCode}`;
  return 'NETWORK';
}

/** Backend hard cap per favorites page. */
const FAVORITES_PAGE_LIMIT = 50;

export async function loadFavorites(page = 1): Promise<LoadFavoritesResult> {
  try {
    const data = await getFavorites({ page, limit: FAVORITES_PAGE_LIMIT });
    return {
      ok: true,
      favorites: data.favorites,
      page: data.pagination.page,
      hasNext: data.pagination.hasNext,
    };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

export async function loadProfile(): Promise<LoadProfileResult> {
  try {
    return { ok: true, profile: await getMe() };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

/**
 * Update the display name. On success the httpOnly rg_user display cookie is
 * re-stamped (merge over the existing value — same pattern as refreshSession's
 * re-stamp) so a hard reload shows the new name; the returned SessionUser lets
 * the island sync AuthProvider in place via applySession.
 */
export async function updateProfile(name: string): Promise<UpdateProfileResult> {
  try {
    const updated = await putProfileName(name);
    const existing = await getSessionUser();
    const user = existing
      ? { ...existing, name: updated.name }
      : {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          role: updated.role,
          avatarUrl: updated.avatarUrl,
        };
    await writeUser(user);
    return { ok: true, user };
  } catch (err) {
    // The name rule's refusal (backend utils/userName.js) is Russian and goes
    // to the form as is: it alone says why — a sign, the length, мат.
    const message =
      err instanceof ApiError ? personText(err.message) : undefined;
    return message
      ? { ok: false, code: codeFromError(err), message }
      : { ok: false, code: codeFromError(err) };
  }
}

/** May the account be deleted now — the island asks before it shows the word. */
export async function checkAccountDeletion(): Promise<AccountDeletionCheckResult> {
  try {
    const check = await getAccountDeletionCheck();
    return { ok: true, allowed: check.allowed === true, refusal: check.refusal ?? null };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

/**
 * Delete the account (brief В1); `confirmation` — the word as typed. On
 * success the session cookies go too: the backend has already ended every
 * session, and a browser left holding them would show a signed-in header over
 * an account that no longer exists.
 *
 * A refusal comes back as its code only: the island asks the check again,
 * whose answer carries the refusal's text and says what holds the account
 * now — the cards that appeared, a block from the panel meanwhile.
 */
export async function deleteAccount(confirmation: string): Promise<DeleteAccountResult> {
  try {
    await deleteOwnAccount(confirmation);
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
  await clearSession();
  return { ok: true };
}
