import 'server-only';

import {
  createEstablishment,
  deleteEstablishment,
  getEstablishment,
  listEstablishments,
  listMenuItems,
  resumeEstablishment,
  retryOcr,
  submitEstablishment,
  suspendEstablishment,
  updateEstablishment,
  updateMenuItem,
} from '@/lib/api/endpoints/partner';
import { getMe } from '@/lib/api/endpoints/profile';
import {
  ApiError,
  type CreateEstablishmentPayload,
  type EstablishmentWriteResult,
  type UpdateEstablishmentPayload,
} from '@/lib/api/types';
import { getSessionUser, refreshSession } from '@/lib/auth/session';
import { personText } from '@/lib/api/person-text';
import {
  cardDropDue,
  cardPagePath,
  refreshCardPage,
  type CardAddressSource,
} from '@/lib/partner/card-page';
import { ocrLimitOf, uploadLimitOf } from '@/lib/partner/errors';
import type { FieldRefusal } from '@/lib/partner/errors';
import type { MenuRecognition } from '@/lib/partner/menu';
import type { MenuItemChanges } from '@/lib/partner/menu-format';
import type {
  CreateResult,
  Failure,
  LoadDetailResult,
  LoadEstablishmentsResult,
  MenuItemWriteResult,
  MenuLoadResult,
  PageRefresh,
  RefreshPageResult,
  RetryOcrResult,
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

/** The fields a field check named — names and texts only, never the values. */
function fieldsOf(details: unknown): FieldRefusal[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const fields: FieldRefusal[] = [];
  for (const entry of details) {
    if (!entry || typeof entry !== 'object' || !('field' in entry)) continue;
    const field = String((entry as { field: unknown }).field);
    const message = personText((entry as { message?: unknown }).message);
    fields.push(message ? { field, message } : { field });
  }
  return fields.length ? fields : undefined;
}

/**
 * A refusal as the cabinet reads it (refusalMessage): the code, the server's
 * text when it is Russian, the fields of a field check, the term of a limit.
 */
function failureFrom(err: unknown): Failure {
  if (!(err instanceof ApiError)) return { ok: false, code: 'NETWORK' };
  const failure: Failure = {
    ok: false,
    code: err.errorCode ?? `HTTP_${err.statusCode}`,
  };
  const message = personText(err.message);
  if (message) failure.message = message;
  const fields = failure.code === 'VALIDATION_ERROR' ? fieldsOf(err.details) : undefined;
  if (fields) failure.fields = fields;
  if (failure.code === 'FORBIDDEN' && err.details && typeof err.details === 'object') {
    const role = (err.details as { your_role?: unknown }).your_role;
    if (typeof role === 'string') failure.role = role;
  }
  if (failure.code === 'RATE_LIMIT_EXCEEDED' && err.details && typeof err.details === 'object') {
    const d = err.details as {
      retry_after?: unknown;
      reset_at?: unknown;
      files_limit?: unknown;
      unconfirmed?: unknown;
    };
    if (typeof d.retry_after === 'number' && d.retry_after > 0) {
      failure.retryAfter = Math.ceil(d.retry_after);
    }
    if (typeof d.reset_at === 'string') failure.resetAt = d.reset_at;
    failure.limit = uploadLimitOf(d);
  }
  return failure;
}

// ---------------------------------------------------------------------------
// The card's public page after the partner's own writes (lib/partner/card-page)
// ---------------------------------------------------------------------------

/** The fields of the save's echo the address is made of (the backend returns the whole row). */
type CardEcho = EstablishmentWriteResult & {
  city?: string | null;
  categories?: string[] | null;
};

/** The form's last accepted city and first category — the address before a save moved it. */
export type PreviousAddress = { city?: string | null; category?: string | null };

/**
 * `page` of a write's answer — only when it tells the cabinet something: the
 * page was dropped, or a drop waits (`retryInMs`). A card no guest sees, or a
 * drop refused by the account's hour, answers without it.
 */
function pageField(page: PageRefresh | undefined): { page?: PageRefresh } {
  return page && (page.refreshed || page.retryInMs) ? { page } : {};
}

/**
 * Drop the card's page after a write. Never fails the write: a failure here
 * leaves the page to renew by itself within the hour.
 */
async function pageAfterWrite(
  cardId: string,
  card: CardAddressSource,
  options: Parameters<typeof refreshCardPage>[3] = {},
): Promise<PageRefresh | undefined> {
  try {
    const user = await getSessionUser();
    return await refreshCardPage(user?.id, cardId, card, options);
  } catch {
    return undefined;
  }
}

/**
 * Drop the page of a card the write's answer does not describe (a menu line,
 * a pause): read the card first — unless its interval would defer the drop
 * anyway, then there is nothing to read it for.
 */
async function pageOfCard(
  cardId: string,
  options: { force?: boolean; requireActive?: boolean } = {},
): Promise<{ page?: PageRefresh; publicPath?: string }> {
  const due = cardDropDue(cardId, { force: options.force });
  if (due) return { page: due };
  try {
    const card = await getEstablishment(cardId);
    const [page, publicPath] = await Promise.all([
      pageAfterWrite(cardId, card, options),
      card.status === 'active' ? cardPagePath(card) : Promise.resolve(null),
    ]);
    return { ...(page ? { page } : {}), ...(publicPath ? { publicPath } : {}) };
  } catch {
    return {};
  }
}

/** Whether the shown state is one a confirmed e-mail would help with (T5). */
function needsEmailHint(recognition: MenuRecognition | null): boolean {
  return (
    recognition?.status === 'not_started' ||
    (recognition?.status === 'failed' && recognition.cause === 'service_failure')
  );
}

/**
 * The account's e-mail is not confirmed — from the account itself
 * (/auth/me: the session's cookie carries no such field), not from the
 * numbers of a refusal. Unknown → false: no hint rather than a wrong one.
 */
async function emailUnconfirmed(): Promise<boolean> {
  try {
    return (await getMe()).emailVerified === false;
  } catch {
    return false;
  }
}

/** Fetch the partner's establishments (all statuses; grouped client-side). */
export async function loadEstablishments(): Promise<LoadEstablishmentsResult> {
  try {
    const data = await listEstablishments();
    return { ok: true, establishments: data.establishments };
  } catch (err) {
    return failureFrom(err);
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
    return failureFrom(err);
  }
}

/**
 * Autosave / edit a draft or existing establishment (PUT). A published card's
 * page is dropped after the save (lib/partner/card-page.ts) — at its address
 * from the save's answer, and at the previous one when the save moved it
 * (`previous`: the form's last accepted city and first category, mapped to an
 * address of this card's own slug only). `drop: false` — the form sent only
 * what the server holds (its autosave as it opens): no drop.
 */
export async function updateEstablishmentAction(
  id: string,
  payload: UpdateEstablishmentPayload,
  previous?: PreviousAddress | null,
  { drop = true }: { drop?: boolean } = {},
): Promise<WriteResult> {
  try {
    const result = (await updateEstablishment(id, payload)) as CardEcho;
    const before =
      previous && (previous.city || previous.category)
        ? { city: previous.city ?? null, categories: previous.category ? [previous.category] : [] }
        : null;
    const page = drop ? await pageAfterWrite(id, result, { previous: before }) : undefined;
    return {
      ok: true,
      status: result.status,
      base_score: result.base_score,
      ...pageField(page),
    };
  } catch (err) {
    return failureFrom(err);
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
    return failureFrom(err);
  }
}

/**
 * Load a single establishment — the card's header and its edit form share
 * this one load. A published card comes with its public address, built here
 * from the card and the site's metadata (lib/partner/card-page.ts).
 */
export async function loadEstablishmentForEdit(
  id: string,
): Promise<LoadDetailResult> {
  try {
    const establishment = await getEstablishment(id);
    const publicPath =
      establishment.status === 'active' ? await cardPagePath(establishment) : null;
    return { ok: true, establishment, ...(publicPath ? { publicPath } : {}) };
  } catch (err) {
    return failureFrom(err);
  }
}

/**
 * «Перезапустить распознавание»: how many files were queued, of how many. A
 * refusal of a limit says which (lib/partner/errors.ts ocrLimitOf — T2 the
 * day's restarts, T3 the day's share), and, for the share, whether the
 * account's e-mail is unconfirmed (T5).
 */
export async function retryOcrAction(id: string): Promise<RetryOcrResult> {
  try {
    const { enqueuedJobs, totalPdfs } = await retryOcr(id);
    return { ok: true, enqueuedJobs, totalPdfs };
  } catch (err) {
    const failure = failureFrom(err);
    if (failure.code !== 'RATE_LIMIT_EXCEEDED' || !(err instanceof ApiError)) return failure;
    const details =
      err.details && typeof err.details === 'object'
        ? (err.details as Parameters<typeof ocrLimitOf>[0])
        : undefined;
    const kind = ocrLimitOf(details);
    failure.limit = kind.limit;
    if (kind.limitCount !== undefined) failure.limitCount = kind.limitCount;
    if (kind.limit === 'ocr_allowance' && (await emailUnconfirmed())) {
      return { ...failure, emailUnconfirmed: true };
    }
    return failure;
  }
}

/**
 * Resume a card the partner paused (suspended → active, no re-moderation).
 * A moderator's suspension is refused by the server (403 ADMIN_SUSPENDED).
 * The card's page is dropped at once — it is back for the guests — and its
 * address comes back for «Посмотреть на сайте».
 */
export async function resumeEstablishmentAction(id: string): Promise<WriteResult> {
  try {
    const result = await resumeEstablishment(id);
    const { page, publicPath } = await pageOfCard(id, { force: true });
    return {
      ok: true,
      status: result.status,
      base_score: result.base_score,
      ...pageField(page),
      ...(publicPath ? { publicPath } : {}),
    };
  } catch (err) {
    return failureFrom(err);
  }
}

/**
 * Pause a published card (active → suspended). The card's page is dropped at
 * once: the guest's next visit finds it gone.
 */
export async function suspendEstablishmentAction(id: string): Promise<WriteResult> {
  try {
    const result = await suspendEstablishment(id);
    const { page } = await pageOfCard(id, { force: true, requireActive: false });
    return {
      ok: true,
      status: result.status,
      base_score: result.base_score,
      ...pageField(page),
    };
  } catch (err) {
    return failureFrom(err);
  }
}

/** The card's «Меню» section: the lines, the state of recognition, the hidden-items fact. */
export async function loadMenuItemsAction(id: string): Promise<MenuLoadResult> {
  try {
    const menu = await listMenuItems(id);
    const hint = needsEmailHint(menu.recognition) && (await emailUnconfirmed());
    return { ok: true, menu, ...(hint ? { emailUnconfirmed: true } : {}) };
  } catch (err) {
    return failureFrom(err);
  }
}

/**
 * Edit a menu line (or «Всё верно» — the line sent back as it is). The
 * server's answer names the line's card (`establishment_id`), whose page is
 * dropped — not the id of a request's address.
 */
export async function updateMenuItemAction(
  itemId: string,
  changes: MenuItemChanges,
): Promise<MenuItemWriteResult> {
  try {
    const item = await updateMenuItem(itemId, changes);
    const { page } = item.establishment_id ? await pageOfCard(item.establishment_id) : {};
    return { ok: true, item, ...pageField(page) };
  } catch (err) {
    return failureFrom(err);
  }
}

/**
 * Drop the card's page now, if it is published: after a re-recognition ended,
 * or when a write's drop was deferred by the card's interval. `final` — the
 * partner leaves the page with a drop still deferred: dropped without the
 * interval, inside the account's hour.
 */
export async function refreshCardPageAction(
  id: string,
  { final = false }: { final?: boolean } = {},
): Promise<RefreshPageResult> {
  try {
    const due = cardDropDue(id, { force: final });
    if (due) return { ok: true, page: due };
    const card = await getEstablishment(id);
    const user = await getSessionUser();
    const page = await refreshCardPage(user?.id, id, card, { force: final });
    return { ok: true, page };
  } catch (err) {
    return failureFrom(err);
  }
}

/** Delete an establishment permanently (draft/rejected; backend cascades media). */
export async function deleteEstablishmentAction(id: string): Promise<WriteResult> {
  try {
    await deleteEstablishment(id);
    return { ok: true };
  } catch (err) {
    return failureFrom(err);
  }
}
