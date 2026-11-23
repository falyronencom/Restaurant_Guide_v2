/**
 * The partner's menu as the cabinet reads it — GET
 * /api/v1/partner/establishments/:id/menu-items (backend
 * partnerMenuItemController.listMenuItems). Pure and client-safe: the
 * operations layer parses the wire here, the menu island groups and edits.
 *
 * WIRE (verified against the controller, not a mock):
 *   { success: true, data: [<row>…], recognition: {…} | null, hasHiddenItems: boolean | null }
 * `recognition` and `hasHiddenItems` sit BESIDE `data`. A row is the table's
 * own `SELECT *` plus `guest_hidden_reason` — no projection: `price_byn` comes
 * as a string ("12.50", node-pg reads NUMERIC so) or null, `sanity_flag` as
 * `{ reason, details }` or null. Items hidden by a moderator are not in the
 * list; only the fact `hasHiddenItems`. Types live here, not in
 * lib/api/types.ts (shared with other threads).
 */

/** Why the guest does not see a line: the server reads it from the name and the section. */
export type GuestHiddenReason = 'alcohol' | 'tobacco';

/** `sanity_flag` — the first rule the recognised row failed (backend ocr/sanityChecker.js). */
export type SanityFlag = {
  /** price_below_threshold | price_above_threshold | low_confidence | price_delta_anomaly, or unknown */
  reason: string | null;
  /** The rule's numbers — each rule has its own (price/threshold, confidence/threshold, …). */
  details: Record<string, unknown>;
};

export type PartnerMenuItem = {
  id: string;
  establishment_id: string;
  media_id: string;
  item_name: string;
  /** BYN; null — no price (a dish inside a set). */
  price_byn: number | null;
  /** The section as recognised or edited; '' and null both mean «no section». */
  category_raw: string | null;
  sanity_flag: SanityFlag | null;
  position: number;
  guest_hidden_reason: GuestHiddenReason | null;
};

export type MenuRecognitionStatus = 'none' | 'processing' | 'failed' | 'not_started' | 'done';

/** The cause of a failed recognition — the advice depends on it. */
export type MenuRecognitionCause = 'unreadable' | 'over_limit' | 'service_failure';

export type MenuRecognition = {
  status: MenuRecognitionStatus;
  /** Only when failed: the partner's sentence from the server. */
  reason: string | null;
  /** Only when failed; null — no code or an unknown one. */
  cause: MenuRecognitionCause | null;
};

export type PartnerMenu = {
  items: PartnerMenuItem[];
  /** null — the server could not read the state (its second query failed). */
  recognition: MenuRecognition | null;
  /** null — the server could not read it. */
  hasHiddenItems: boolean | null;
};

const STATUSES: readonly MenuRecognitionStatus[] = ['none', 'processing', 'failed', 'not_started', 'done'];
const CAUSES: readonly MenuRecognitionCause[] = ['unreadable', 'over_limit', 'service_failure'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A price as the wire sends it — "12.50", 12.5, null — as a number, or null. */
export function priceOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function flagOf(value: unknown): SanityFlag | null {
  if (!isRecord(value)) return null;
  return {
    reason: typeof value.reason === 'string' ? value.reason : null,
    details: isRecord(value.details) ? value.details : {},
  };
}

/** One row of the wire, or null when it lacks what the cabinet needs to show and edit it. */
export function menuItemOf(raw: unknown): PartnerMenuItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.item_name !== 'string') {
    return null;
  }
  const hidden = raw.guest_hidden_reason;
  return {
    id: raw.id,
    establishment_id: typeof raw.establishment_id === 'string' ? raw.establishment_id : '',
    media_id: typeof raw.media_id === 'string' ? raw.media_id : '',
    item_name: raw.item_name,
    price_byn: priceOf(raw.price_byn),
    category_raw: typeof raw.category_raw === 'string' ? raw.category_raw : null,
    sanity_flag: flagOf(raw.sanity_flag),
    position: typeof raw.position === 'number' ? raw.position : 0,
    guest_hidden_reason: hidden === 'alcohol' || hidden === 'tobacco' ? hidden : null,
  };
}

/** `recognition` of the wire; null — absent, unreadable or a status this site does not know. */
export function recognitionOf(raw: unknown): MenuRecognition | null {
  if (!isRecord(raw)) return null;
  const status = STATUSES.find((s) => s === raw.status);
  if (!status) return null;
  const failed = status === 'failed';
  const reason = typeof raw.reason === 'string' && raw.reason.trim() !== '' ? raw.reason : null;
  const cause = CAUSES.find((c) => c === raw.cause) ?? null;
  return {
    status,
    reason: failed ? reason : null,
    cause: failed ? cause : null,
  };
}

/** The whole success body of GET …/menu-items. */
export function partnerMenuOf(body: unknown): PartnerMenu {
  const envelope = isRecord(body) ? body : {};
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  return {
    items: rows.map(menuItemOf).filter((item): item is PartnerMenuItem => item !== null),
    recognition: recognitionOf(envelope.recognition),
    hasHiddenItems: typeof envelope.hasHiddenItems === 'boolean' ? envelope.hasHiddenItems : null,
  };
}

/** A section of the list: '' — no section («Без раздела»). */
export type MenuSectionGroup = { key: string; items: PartnerMenuItem[] };

/** '' and null are one «no section»; otherwise the section as stored. */
export const sectionKeyOf = (item: Pick<PartnerMenuItem, 'category_raw'>): string =>
  item.category_raw ?? '';

/**
 * Items grouped by section in the order a section first appears; inside a
 * section — the server's order (position, then name).
 */
export function groupBySection(items: readonly PartnerMenuItem[]): MenuSectionGroup[] {
  const groups = new Map<string, PartnerMenuItem[]>();
  for (const item of items) {
    const key = sectionKeyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, items: list }));
}

/** The sections of this card, for the editor's suggestions: distinct, non-empty, in order. */
export function sectionsOf(items: readonly PartnerMenuItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    const key = sectionKeyOf(item).trim();
    if (key !== '') seen.add(key);
  }
  return [...seen];
}

/** Put the server's answer for one row in its place by id (the copies come with the re-read). */
export function replaceItem(
  items: readonly PartnerMenuItem[],
  updated: PartnerMenuItem,
): PartnerMenuItem[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}
