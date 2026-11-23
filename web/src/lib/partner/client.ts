import type {
  CreateEstablishmentPayload,
  UpdateEstablishmentPayload,
} from '@/lib/api/types';
import type { MenuItemChanges } from '@/lib/partner/menu-format';
import type {
  CreateResult,
  LoadDetailResult,
  LoadEstablishmentsResult,
  MenuItemWriteResult,
  MenuLoadResult,
  RefreshPageResult,
  RetryOcrResult,
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
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<T | { ok: false; code: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      // A request sent as the page goes away (lib/partner/page-refresh-client).
      ...(keepalive ? { keepalive: true } : {}),
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

/**
 * `previous` — the form's last accepted city and first category: when the
 * save moves the card to another address, the server drops the page at the
 * old one too (it builds that address itself, of this card's own slug). In
 * the query, not the body: the body goes to the API verbatim.
 */
export function updateEstablishmentAction(
  id: string,
  payload: UpdateEstablishmentPayload,
  previous?: { city?: string | null; category?: string | null } | null,
): Promise<WriteResult> {
  const query = new URLSearchParams();
  if (previous?.city) query.set('prevCity', previous.city);
  if (previous?.category) query.set('prevCategory', previous.category);
  const qs = query.toString();
  return postPartner<WriteResult>(
    `${BASE}/${encodeURIComponent(id)}/update${qs ? `?${qs}` : ''}`,
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

export function retryOcrAction(id: string): Promise<RetryOcrResult> {
  return postPartner<RetryOcrResult>(
    `${BASE}/${encodeURIComponent(id)}/retry-ocr`,
  );
}

export function resumeEstablishmentAction(id: string): Promise<WriteResult> {
  return postPartner<WriteResult>(`${BASE}/${encodeURIComponent(id)}/resume`);
}

export function suspendEstablishmentAction(id: string): Promise<WriteResult> {
  return postPartner<WriteResult>(`${BASE}/${encodeURIComponent(id)}/suspend`);
}

export function loadMenuItems(id: string): Promise<MenuLoadResult> {
  return postPartner<MenuLoadResult>(`${BASE}/${encodeURIComponent(id)}/menu-items`);
}

export function updateMenuItemAction(
  itemId: string,
  changes: MenuItemChanges,
): Promise<MenuItemWriteResult> {
  return postPartner<MenuItemWriteResult>(
    `/api/partner/menu-items/${encodeURIComponent(itemId)}/update`,
    changes,
  );
}

/**
 * Drop the card's public page now, if it is published. `final` — the partner
 * leaves with a drop still deferred: sent `keepalive`, so it outlives the page.
 */
export function refreshCardPageAction(
  id: string,
  { final = false }: { final?: boolean } = {},
): Promise<RefreshPageResult> {
  return postPartner<RefreshPageResult>(
    `${BASE}/${encodeURIComponent(id)}/refresh-page${final ? '?final=1' : ''}`,
    undefined,
    { keepalive: final },
  );
}

export function deleteEstablishmentAction(id: string): Promise<WriteResult> {
  return postPartner<WriteResult>(`${BASE}/${encodeURIComponent(id)}/delete`);
}
