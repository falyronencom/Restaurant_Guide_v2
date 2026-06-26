import type {
  CreateEstablishmentPayload,
  UpdateEstablishmentPayload,
} from '@/lib/api/types';
import type {
  CreateResult,
  LoadDetailResult,
  LoadEstablishmentsResult,
  WriteResult,
} from '@/lib/partner/results';

/*
 * Partner cabinet client fetchers (CAT-C-3.14). Same names + signatures as the
 * former Server Actions in lib/partner/actions, so the cabinet islands change
 * ONLY their import path. Each POSTs same-origin to a buffered Route Handler
 * (app/api/partner/establishments/*) — edge-503-immune, unlike the streamed
 * Server-Action transport. A same-origin fetch carries the httpOnly session
 * cookies automatically; the handler enforces the same-origin CSRF guard.
 *
 * The Route Handlers ALWAYS return a {ok,…} JSON envelope (including the 403
 * CSRF rejection), and a transport failure is mapped to NETWORK below — so
 * callers branch on `r.ok` exactly as they did with the Server Actions.
 */

const BASE = '/api/partner/establishments';

async function postPartner<T extends { ok: boolean }>(
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
    // Transport failure (offline, DNS, abort) — mirror the operations layer's
    // NETWORK fallback so the UX is identical to the former Server Action.
    return { ok: false, code: 'NETWORK' };
  }
}

export function loadEstablishments(): Promise<LoadEstablishmentsResult> {
  return postPartner<LoadEstablishmentsResult>(`${BASE}/list`);
}

export function createEstablishmentAction(
  payload: CreateEstablishmentPayload,
): Promise<CreateResult> {
  return postPartner<CreateResult>(`${BASE}/create`, payload);
}

export function updateEstablishmentAction(
  id: string,
  payload: UpdateEstablishmentPayload,
): Promise<WriteResult> {
  return postPartner<WriteResult>(
    `${BASE}/${encodeURIComponent(id)}/update`,
    payload,
  );
}

export function submitEstablishmentAction(id: string): Promise<WriteResult> {
  return postPartner<WriteResult>(`${BASE}/${encodeURIComponent(id)}/submit`);
}

export function loadEstablishmentForEdit(
  id: string,
): Promise<LoadDetailResult> {
  return postPartner<LoadDetailResult>(
    `${BASE}/${encodeURIComponent(id)}/load`,
  );
}

export function retryOcrAction(id: string): Promise<WriteResult> {
  return postPartner<WriteResult>(
    `${BASE}/${encodeURIComponent(id)}/retry-ocr`,
  );
}
