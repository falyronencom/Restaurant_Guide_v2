import 'server-only';

import { authedFetch } from '@/lib/auth/session';
import type {
  CreateEstablishmentPayload,
  EstablishmentWriteResult,
  PartnerEstablishmentDetail,
  PartnerEstablishmentListResponse,
  UpdateEstablishmentPayload,
} from '@/lib/api/types';

/*
 * Partner establishment endpoints (Phase C Slice 1, Segment B) over
 * /api/v1/partner/establishments. authedFetch injects the Bearer and refreshes
 * transparently, so these are reachable ONLY from Server Actions or Route
 * Handlers (session.ts). Thin wrappers: no error mapping here — the operations
 * layer russifies codes.
 *
 * WIRE ENVELOPE (verified against establishmentController.js): create / get /
 * update / submit wrap the entity as `data: { establishment: {…} }` — these
 * wrappers UNWRAP it. Only the list returns `data: { establishments, pagination }`
 * directly. Casting `data` as the entity itself made every `.id`/`.name` read
 * undefined: the wizard never stored its draftId (→ each autosave re-CREATEd →
 * DUPLICATE_ESTABLISHMENT) and the edit form seeded empty. Unit tests mock THIS
 * boundary, so only a live wire call could catch it — partner-endpoints.test.ts
 * now pins the envelope.
 *
 * Casing/shape are snake_case JSON bodies (mirrors the backend validator); a
 * mismatch is a silent 422. The create/update payloads are built by
 * lib/partner/form.toCreatePayload / toUpdatePayload.
 */

const BASE = '/api/v1/partner/establishments';

/**
 * List the partner's establishments. No `?status` filter — the cabinet fetches
 * all and groups by status client-side (a partner has few cards; the backend
 * caps page size at 50). limit=50 keeps it to a single page in practice.
 */
export async function listEstablishments(): Promise<PartnerEstablishmentListResponse> {
  return authedFetch<PartnerEstablishmentListResponse>(`${BASE}?limit=50`);
}

export async function getEstablishment(
  id: string,
): Promise<PartnerEstablishmentDetail> {
  const data = await authedFetch<{ establishment: PartnerEstablishmentDetail }>(
    `${BASE}/${encodeURIComponent(id)}`,
  );
  return data.establishment;
}

export async function createEstablishment(
  payload: CreateEstablishmentPayload,
): Promise<EstablishmentWriteResult> {
  const data = await authedFetch<{ establishment: EstablishmentWriteResult }>(
    BASE,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return data.establishment;
}

export async function updateEstablishment(
  id: string,
  payload: UpdateEstablishmentPayload,
): Promise<EstablishmentWriteResult> {
  const data = await authedFetch<{ establishment: EstablishmentWriteResult }>(
    `${BASE}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return data.establishment;
}

/** Submit a draft/rejected/suspended establishment for moderation (→ pending). */
export async function submitEstablishment(
  id: string,
): Promise<EstablishmentWriteResult> {
  const data = await authedFetch<{ establishment: EstablishmentWriteResult }>(
    `${BASE}/${encodeURIComponent(id)}/submit`,
    { method: 'POST' },
  );
  return data.establishment;
}

/**
 * Re-enqueue OCR for the establishment's menu media — the recovery for the
 * PUT-media-sync asymmetry (menu photos added via PUT do not auto-enqueue OCR;
 * see Segment A Completion Report). POST /:id/retry-ocr.
 */
export async function retryOcr(id: string): Promise<unknown> {
  return authedFetch(`${BASE}/${encodeURIComponent(id)}/retry-ocr`, {
    method: 'POST',
  });
}

/** Permanently delete an establishment (backend cascades media). Owner-checked. */
export async function deleteEstablishment(id: string): Promise<void> {
  await authedFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
