import 'server-only';

import { revalidatePath } from 'next/cache';

import { getMetadata } from '@/lib/api/endpoints/metadata';
import type { PublicMetadata } from '@/lib/api/types';
import { isDetailPathOf } from '@/lib/detail-path';
import { FALLBACK_CATEGORY_SLUG, FALLBACK_CITY_SLUG } from '@/lib/establishment-path';
import type { PageRefresh } from '@/lib/partner/results';

/*
 * The public page of a card, as the cabinet drops it after the partner's own
 * writes (part 1 of the thread «Кабинет партнёра на сайте», directive 1.8;
 * technical, delegated by the Coordinator).
 *
 * The page /{city}/{category}/{slug} is ISR, kept for an hour (page.tsx
 * `revalidate = 3600`); before this an edit made in the cabinet reached the
 * guest within that hour. Now every write that changes the guest's page —
 * the form's save of a published card, a dish's edit, «Всё верно», the pause
 * and the resume, the end of a re-recognition — marks the card's literal path
 * out of date (revalidatePath from a Route Handler: «the revalidation is done
 * on the next visit», Next 16 docs). Nothing is rebuilt by the drop itself;
 * the next guest's visit renders the page afresh from the site's own API
 * budget (about four calls), so the drops are bounded:
 *
 *   - per card: at most one drop in CARD_INTERVAL_MS. The first write after a
 *     quiet spell drops at once; a write inside the interval is answered
 *     «deferred, retry in N ms», and the cabinet's island calls refresh-page
 *     then (lib/partner/page-refresh-client.ts) — so the latest state reaches
 *     the guest within the interval of the last write. A drop cannot be timed
 *     here on the server: revalidatePath works only inside a request.
 *   - per account: at most DROPS_PER_ACCOUNT_HOUR. Past it the write goes
 *     through, the page is not dropped (it renews by itself within the hour)
 *     and a warning goes to the log.
 *   - the pause, the resume and a change of the card's address drop at once
 *     whatever the interval (`force`), inside the account's hour.
 *   - the visitors' allowance (lib/cached-page-drops.ts mayDropCachedPage) is
 *     not spent: that one guards drops any browser may ask for.
 *
 * The address is built here, on the site's server, from the API's answer —
 * the card's slug, its city and its first category — never taken from the
 * browser. City and category become their URL parts through the site's
 * metadata (/api/v1/public/metadata), the same maps the API's public
 * projection uses (backend constants/urlSlugs.js): the city compared without
 * the difference of «ё» and «е» (the API maps both «Могилёв» and «Могилев» to
 * mogilev, the metadata names it «Могилев»), the category exactly; unknown
 * parts fall back as establishmentAddress() does.
 *
 * Memory is per instance, like cached-page-drops.ts: the site runs one
 * (a drop on one of several instances would reach that one only).
 */

export const CARD_INTERVAL_MS = 30_000;
export const DROPS_PER_ACCOUNT_HOUR = 300;
const HOUR_MS = 60 * 60 * 1000;

export type { PageRefresh };

/** The fields of a card its address is made of — as the partner API answers. */
export type CardAddressSource = {
  slug?: string | null;
  city?: string | null;
  categories?: readonly string[] | null;
  status?: string | null;
};

type Metadata = Pick<PublicMetadata, 'cities' | 'categories'>;

/** «ё» and «Ё» read as «е» and «Е» — the one difference the API's city map forgives. */
export function foldYo(text: string): string {
  return text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}

/** The card's own public address, or null when it has no slug to have one. */
export function cardPagePathFrom(card: CardAddressSource, meta: Metadata): string | null {
  const slug = card.slug;
  if (typeof slug !== 'string' || slug === '') return null;
  const city = typeof card.city === 'string' ? foldYo(card.city) : null;
  const citySlug =
    (city !== null && meta.cities.find((c) => foldYo(c.name) === city)?.slug) || FALLBACK_CITY_SLUG;
  const first = card.categories?.[0];
  const categorySlug =
    (typeof first === 'string' && meta.categories.find((c) => c.name === first)?.slug) ||
    FALLBACK_CATEGORY_SLUG;
  const path = `/${citySlug}/${categorySlug}/${slug}`;
  // Plain segments only — the form the page and its revalidation accept.
  return isDetailPathOf(path, slug) ? path : null;
}

/** The card's address with the site's metadata, or null (no slug, or no metadata). */
export async function cardPagePath(card: CardAddressSource): Promise<string | null> {
  if (typeof card.slug !== 'string' || card.slug === '') return null;
  try {
    return cardPagePathFrom(card, await getMetadata());
  } catch {
    // Without the metadata the city and category parts are unknown: no
    // address is better than a wrong one.
    return null;
  }
}

// ---------------------------------------------------------------------------
// The bounds of the drops
// ---------------------------------------------------------------------------

let lastDropAt = new Map<string, number>();
let accountHours = new Map<string, { start: number; count: number }>();

function accountHour(userId: string, now: number) {
  let hour = accountHours.get(userId);
  if (!hour || now - hour.start >= HOUR_MS) {
    hour = { start: now, count: 0 };
    accountHours.set(userId, hour);
  }
  return hour;
}

function forgetOld(now: number): void {
  for (const [card, at] of lastDropAt) {
    if (now - at >= CARD_INTERVAL_MS) lastDropAt.delete(card);
  }
  for (const [user, hour] of accountHours) {
    if (now - hour.start >= HOUR_MS) accountHours.delete(user);
  }
}

/** ms until the card may be dropped again; 0 — now. */
function waitFor(cardId: string, now: number): number {
  const at = lastDropAt.get(cardId);
  return at === undefined ? 0 : Math.max(0, at + CARD_INTERVAL_MS - now);
}

/**
 * Whether a drop of this card would be taken now, before any work is done for
 * it (the caller may skip reading the card from the API). The final check is
 * dropCardPaths', after the awaits.
 */
export function cardDropDue(cardId: string, { force = false }: { force?: boolean } = {}): PageRefresh | null {
  if (force) return null;
  const wait = waitFor(cardId, Date.now());
  return wait > 0 ? { refreshed: false, retryInMs: wait } : null;
}

/**
 * Drop the card's page at these addresses, within the bounds. Every check runs
 * here, synchronously, next to the counts it guards — after the caller's
 * awaits (a burst waiting on the API together must not pass the hour's count
 * at once).
 */
export function dropCardPaths(
  userId: string,
  cardId: string,
  paths: readonly string[],
  { force = false }: { force?: boolean } = {},
): PageRefresh {
  const now = Date.now();
  forgetOld(now);
  const unique = [...new Set(paths)];
  if (unique.length === 0) return { refreshed: false };
  if (!force) {
    const wait = waitFor(cardId, now);
    if (wait > 0) return { refreshed: false, retryInMs: wait };
  }
  const hour = accountHour(userId, now);
  if (hour.count + unique.length > DROPS_PER_ACCOUNT_HOUR) {
    console.warn(
      `[card-page] the account's hour of page drops is spent (${DROPS_PER_ACCOUNT_HOUR}): the card's page is not dropped`,
      { cardId, paths: unique.length },
    );
    return { refreshed: false };
  }
  for (const path of unique) revalidatePath(path);
  hour.count += unique.length;
  lastDropAt.set(cardId, now);
  return { refreshed: true };
}

/**
 * Drop the page of a card the partner just wrote: its address (and, when the
 * write moved it, the previous one) from the API's answer. `requireActive` —
 * only a published card has a page a guest sees; the pause drops a card that
 * has just stopped being one.
 */
export async function refreshCardPage(
  userId: string | null | undefined,
  cardId: string,
  card: CardAddressSource,
  {
    force = false,
    requireActive = true,
    previous,
  }: { force?: boolean; requireActive?: boolean; previous?: CardAddressSource | null } = {},
): Promise<PageRefresh> {
  if (!userId) return { refreshed: false };
  if (requireActive && card.status !== 'active') return { refreshed: false };
  const path = await cardPagePath(card);
  if (!path) return { refreshed: false };
  const paths = [path];
  let moved = false;
  if (previous) {
    // The previous city and category, with this card's own slug: only an
    // address of this card in the canonical form can come out of it.
    const before = await cardPagePath({ ...previous, slug: card.slug });
    if (before && before !== path) {
      paths.push(before);
      moved = true;
    }
  }
  return dropCardPaths(userId, cardId, paths, { force: force || moved });
}

/** Test-only: forget every drop. */
export function _resetForTests(): void {
  lastDropAt = new Map();
  accountHours = new Map();
}
