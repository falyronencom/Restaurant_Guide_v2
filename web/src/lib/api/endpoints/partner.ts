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
 * transparently, so these are reachable ONLY from Server Actions (session.ts).
 * Thin wrappers: no error mapping here — the actions layer russifies codes.
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
  return authedFetch<PartnerEstablishmentDetail>(
    `${BASE}/${encodeURIComponent(id)}`,
  );
}

export async function createEstablishment(
  payload: CreateEstablishmentPayload,
): Promise<EstablishmentWriteResult> {
  return authedFetch<EstablishmentWriteResult>(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateEstablishment(
  id: string,
  payload: UpdateEstablishmentPayload,
): Promise<EstablishmentWriteResult> {
  return authedFetch<EstablishmentWriteResult>(
    `${BASE}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/** Submit a draft/rejected/suspended establishment for moderation (→ pending). */
export async function submitEstablishment(
  id: string,
): Promise<EstablishmentWriteResult> {
  return authedFetch<EstablishmentWriteResult>(
    `${BASE}/${encodeURIComponent(id)}/submit`,
    { method: 'POST' },
  );
}
