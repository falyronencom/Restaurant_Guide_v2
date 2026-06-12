'use server';

import {
  createEstablishment,
  listEstablishments,
  submitEstablishment,
  updateEstablishment,
} from '@/lib/api/endpoints/partner';
import {
  ApiError,
  type CreateEstablishmentPayload,
  type EstablishmentStatus,
  type PartnerEstablishmentListing,
  type SessionUser,
  type UpdateEstablishmentPayload,
} from '@/lib/api/types';
import { getSessionUser, refreshSession } from '@/lib/auth/session';

/*
 * Partner cabinet Server Actions (Phase C Slice 1, Segment B).
 *
 * State-changing + authed-read operations are Server Actions for the built-in
 * CSRF defense AND because authedFetch may rotate the single-use refresh token
 * (a cookie WRITE), illegal during RSC render — only a Server Action or Route
 * Handler may write cookies. Thin: codes are russified client-side via
 * lib/partner/errors (mirrors the Slice 1-2 split).
 */

function codeFromError(err: unknown): string {
  if (err instanceof ApiError) return err.errorCode ?? `HTTP_${err.statusCode}`;
  return 'NETWORK';
}

export type LoadEstablishmentsResult =
  | { ok: true; establishments: PartnerEstablishmentListing[] }
  | { ok: false; code: string };

/** Fetch the partner's establishments (all statuses; grouped client-side). */
export async function loadEstablishments(): Promise<LoadEstablishmentsResult> {
  try {
    const data = await listEstablishments();
    return { ok: true, establishments: data.establishments };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

export type CreateResult =
  | {
      ok: true;
      id: string;
      status?: EstablishmentStatus;
      base_score?: number | null;
      /** Re-stamped display user after the first create (role → partner), else unchanged. */
      user: SessionUser | null;
    }
  | { ok: false; code: string };

/**
 * Create a draft establishment. The FIRST create upgrades the user → partner
 * (backend establishmentService → upgradeUserToPartner). Force a refreshSession
 * so a fresh access token carries role=partner AND rg_user is re-stamped to it —
 * only when the role is still 'user' (avoids needless rotation on later creates).
 * The returned `user` lets the client sync its AuthProvider context.
 */
export async function createEstablishmentAction(
  payload: CreateEstablishmentPayload,
): Promise<CreateResult> {
  try {
    const before = await getSessionUser();
    const result = await createEstablishment(payload);

    let user = before;
    if (before?.role === 'user') {
      await refreshSession();
      user = await getSessionUser();
    }

    return {
      ok: true,
      id: result.id,
      status: result.status,
      base_score: result.base_score,
      user,
    };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

export type WriteResult =
  | { ok: true; status?: EstablishmentStatus; base_score?: number | null }
  | { ok: false; code: string };

/** Autosave / edit a draft or existing establishment (PUT). */
export async function updateEstablishmentAction(
  id: string,
  payload: UpdateEstablishmentPayload,
): Promise<WriteResult> {
  try {
    const result = await updateEstablishment(id, payload);
    return { ok: true, status: result.status, base_score: result.base_score };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

/** Submit a draft/rejected/suspended establishment for moderation (→ pending). */
export async function submitEstablishmentAction(
  id: string,
): Promise<WriteResult> {
  try {
    const result = await submitEstablishment(id);
    return { ok: true, status: result.status, base_score: result.base_score };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}
