import 'server-only';

import { authedFetch } from '@/lib/auth/session';
import {
  ApiError,
  type CreateEstablishmentPayload,
  type EstablishmentWriteResult,
  type PartnerEstablishmentDetail,
  type PartnerEstablishmentListResponse,
  type UpdateEstablishmentPayload,
} from '@/lib/api/types';
import {
  menuItemOf,
  partnerMenuOf,
  type PartnerMenu,
  type PartnerMenuItem,
} from '@/lib/partner/menu';
import type { MenuItemChanges } from '@/lib/partner/menu-format';

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
 * Resume an establishment the partner paused (suspended → active). The server
 * refuses a moderator's suspension (403 ADMIN_SUSPENDED).
 */
export async function resumeEstablishment(
  id: string,
): Promise<EstablishmentWriteResult> {
  const data = await authedFetch<{ establishment: EstablishmentWriteResult }>(
    `${BASE}/${encodeURIComponent(id)}/resume`,
    { method: 'POST' },
  );
  return data.establishment;
}

/**
 * Read the card's menu again from every menu file — POST /:id/retry-ocr
 * (backend partnerMenuItemService.retryOcr). Saving the card queues the
 * recognition of new menu files by itself (backend establishmentService,
 * media sync); this is the partner's «Перезапустить распознавание»: every
 * file, the recognised ones too. 202 `data: { enqueuedJobs, totalPdfs }` —
 * `totalPdfs` counts the menu files of every kind (the name predates menu
 * photos).
 */
export async function retryOcr(id: string): Promise<{ enqueuedJobs: number; totalPdfs: number }> {
  const data = await authedFetch<{ enqueuedJobs?: unknown; totalPdfs?: unknown }>(
    `${BASE}/${encodeURIComponent(id)}/retry-ocr`,
    { method: 'POST' },
  );
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return { enqueuedJobs: count(data?.enqueuedJobs), totalPdfs: count(data?.totalPdfs) };
}

/**
 * The card's recognised menu — GET /:id/menu-items. The answer puts the
 * recognition state and the hidden-items fact BESIDE `data`
 * (backend partnerMenuItemController.listMenuItems), so the whole body is
 * read (`envelope`), then parsed (lib/partner/menu.ts).
 */
export async function listMenuItems(id: string): Promise<PartnerMenu> {
  const body = await authedFetch<unknown>(
    `${BASE}/${encodeURIComponent(id)}/menu-items`,
    undefined,
    { envelope: true },
  );
  return partnerMenuOf(body);
}

/**
 * Edit one menu line — PATCH /api/v1/partner/menu-items/:id with the changed
 * fields only. The server writes the line and its copies in the other menu
 * files at once, clears their marks, and answers with the line alone
 * (`data`: the row as the list has it) — the copies come with a re-read.
 */
export async function updateMenuItem(
  itemId: string,
  changes: MenuItemChanges,
): Promise<PartnerMenuItem> {
  const row = await authedFetch<unknown>(
    `/api/v1/partner/menu-items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    },
  );
  const item = menuItemOf(row);
  if (!item) throw new ApiError(502, 'Unexpected menu item in the answer', 'UNEXPECTED_ANSWER');
  return item;
}

/** Pause a published card (active → suspended) — POST /:id/suspend. */
export async function suspendEstablishment(
  id: string,
): Promise<EstablishmentWriteResult> {
  const data = await authedFetch<{ establishment: EstablishmentWriteResult }>(
    `${BASE}/${encodeURIComponent(id)}/suspend`,
    { method: 'POST' },
  );
  return data.establishment;
}

/** Permanently delete an establishment (backend cascades media). Owner-checked. */
export async function deleteEstablishment(id: string): Promise<void> {
  await authedFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
