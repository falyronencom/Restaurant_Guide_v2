import 'server-only';

import {
  createEstablishment,
  getEstablishment,
  listEstablishments,
  retryOcr,
  submitEstablishment,
  updateEstablishment,
} from '@/lib/api/endpoints/partner';
import {
  ApiError,
  type CreateEstablishmentPayload,
  type UpdateEstablishmentPayload,
} from '@/lib/api/types';
import { getSessionUser, refreshSession } from '@/lib/auth/session';
import type {
  CreateResult,
  LoadDetailResult,
  LoadEstablishmentsResult,
  WriteResult,
} from '@/lib/partner/results';

/*
 * Partner cabinet operations (CAT-C-3.14). Plain server-only async functions
 * returning discriminated {ok,…} envelopes. Formerly the Phase C Slice 1
 * `actions.ts` Server Actions; the `'use server'` transport was dropped and the
 * six are now invoked from buffered POST Route Handlers (app/api/partner/
 * establishments/*) so the cabinet is edge-503-immune — the Railway edge 503s
 * STREAMED Server-Action responses (text/x-component) while origin returns 200;
 * buffered JSON over a Route Handler is unaffected. Behaviour is byte-identical:
 * only the transport changed.
 *
 * Cookie writes remain legal: a Route Handler, exactly like a Server Action, may
 * set/delete cookies — so authedFetch's transparent single-use refresh-token
 * rotation (reachable from every operation) and the create-path refreshSession()
 * below still work. Codes are russified client-side via lib/partner/errors.
 */

function codeFromError(err: unknown): string {
  if (err instanceof ApiError) return err.errorCode ?? `HTTP_${err.statusCode}`;
  return 'NETWORK';
}

/** Fetch the partner's establishments (all statuses; grouped client-side). */
export async function loadEstablishments(): Promise<LoadEstablishmentsResult> {
  try {
    const data = await listEstablishments();
    return { ok: true, establishments: data.establishments };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

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

/** Load a single establishment for the edit wizard. */
export async function loadEstablishmentForEdit(
  id: string,
): Promise<LoadDetailResult> {
  try {
    const establishment = await getEstablishment(id);
    return { ok: true, establishment };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}

/** Re-enqueue menu OCR (recovery for the PUT-media-sync OCR asymmetry). */
export async function retryOcrAction(id: string): Promise<WriteResult> {
  try {
    await retryOcr(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: codeFromError(err) };
  }
}
