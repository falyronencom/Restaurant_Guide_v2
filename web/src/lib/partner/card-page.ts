import 'server-only';

import { revalidatePath } from 'next/cache';

import { getMetadata } from '@/lib/api/endpoints/metadata';
import type { PublicMetadata } from '@/lib/api/types';
import { isDetailPathOf } from '@/lib/detail-path';
import { noteCardAddress } from '@/lib/known-slugs';
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
 * budget (11 calls, measured — DROPS_PER_SITE_HOUR), so the drops are bounded,
 * and every bound is kept by what the API answered, never by what the
 * browser says (Trunk, addendum 1 to the directive, 1.2–1.3):
 *
 *   - per card: at most one drop in CARD_INTERVAL_MS — every drop, the pause,
 *     the resume and a moved address too. The first write after a quiet spell
 *     drops at once; a write inside the interval is remembered and answered
 *     «deferred, retry in N ms», and the cabinet's island calls refresh-page
 *     then (lib/partner/page-refresh-client.ts), which drops what was
 *     remembered — so the latest state reaches the guest within the interval
 *     of the last write. A drop cannot be timed here on the server:
 *     revalidatePath works only inside a request. The island's `final` (the
 *     page goes away with a drop still deferred) skips the interval only when
 *     this server deferred a drop of the card.
 *   - per account: at most DROPS_PER_ACCOUNT_HOUR, the account being the
 *     card's owner in the API's answer (partner_id) — not the session's
 *     cookie, which the browser may write as it likes.
 *   - per site: at most DROPS_PER_SITE_HOUR, every account together.
 *   - past an hour the write goes through, the page is not dropped (it renews
 *     by itself within the hour) and a warning goes to the log.
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
/**
 * Drops per account (the card's owner as the API answers) in an hour. The
 * addendum's 60 was half of its 120 for the site; with the site's bound set
 * by the measurement (54), half of it — 27 — keeps that share (chosen by the
 * session; at 60 the account's bound would never be reached before the
 * site's).
 */
export const DROPS_PER_ACCOUNT_HOUR = 27;
/**
 * The cabinet's drops in an hour for the whole site, every account together
 * (Trunk, addendum 1, 1.3): about a tenth of the site's budget at the API
 * (6000 calls an hour, backend middleware/rateLimiter.js), a drop costing one
 * rebuild of the page at the guest's next visit. Measured on the stand
 * 23.11.2026 (`next start`, a counting proxy before the API): 11 calls — the
 * card, its menu, its reviews, the metadata and 7 probes of the cities by the
 * public layout (the dropped path renders with its data cache out of date
 * too). 600 / 11 → 54.
 */
export const DROPS_PER_SITE_HOUR = 54;
/** How long a drop the interval deferred is kept for its timer — or `final` — to take. */
export const DEFERRED_TTL_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type { PageRefresh };

/** The fields of a card its address is made of — as the partner API answers. */
export type CardAddressSource = {
  slug?: string | null;
  city?: string | null;
  categories?: readonly string[] | null;
  status?: string | null;
  /** The card's owner as the API answered — the key of the account's hour. */
  partner_id?: string | null;
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
let siteHour = { start: 0, count: 0 };
/** The drops the card's interval deferred: whose card, which addresses, since when. */
let deferred = new Map<string, { owner: string; paths: Set<string>; at: number }>();

/** The hour that runs now: this one, or a new one when it is over. */
function hourAt(hour: { start: number; count: number } | undefined, now: number) {
  return hour && now - hour.start < HOUR_MS ? hour : { start: now, count: 0 };
}

function forgetOld(now: number): void {
  for (const [card, at] of lastDropAt) {
    if (now - at >= CARD_INTERVAL_MS) lastDropAt.delete(card);
  }
  for (const [owner, hour] of accountHours) {
    if (now - hour.start >= HOUR_MS) accountHours.delete(owner);
  }
  for (const [card, kept] of deferred) {
    if (now - kept.at >= DEFERRED_TTL_MS) deferred.delete(card);
  }
}

/** ms until the card may be dropped again; 0 — now. */
function waitFor(cardId: string, now: number): number {
  const at = lastDropAt.get(cardId);
  return at === undefined ? 0 : Math.max(0, at + CARD_INTERVAL_MS - now);
}

/**
 * Drop the card's page at these addresses, within the bounds. `owner` — the
 * card's owner as the API answered it to this partner's token (the card's
 * partner_id), never the session's cookie: rg_user is not signed, it is only
 * good for showing. Every check runs here, synchronously, next to the counts
 * it guards — after the caller's awaits (a burst waiting on the API together
 * must not pass the hour's count at once). Each address dropped counts one.
 *
 * A drop inside the card's interval is deferred: remembered here with its
 * addresses (the old address of a moved card, the page of a card just
 * paused) and answered «retry in N ms»; the cabinet's island asks
 * refresh-page then, and the remembered addresses go with that drop. `final`
 * (the partner leaves the page) is taken without the interval only when this
 * server deferred a drop of a write of this card for this owner — not on the
 * browser's word; refresh-page itself (`remember: false`) defers without
 * leaving anything to remember, so asking it twice opens no way past the
 * interval. Past the account's or the site's hour the write goes through,
 * the page is not dropped (it renews by itself within the hour) and a
 * warning goes to the log.
 */
export function dropCardPaths(
  owner: string,
  cardId: string,
  paths: readonly string[],
  { final = false, remember = true }: { final?: boolean; remember?: boolean } = {},
): PageRefresh {
  const now = Date.now();
  forgetOld(now);
  const kept = deferred.get(cardId);
  const ownKept = kept && kept.owner === owner ? kept : undefined;
  const unique = new Set(paths);
  if (ownKept) for (const path of ownKept.paths) unique.add(path);
  if (unique.size === 0) return { refreshed: false };
  const wait = waitFor(cardId, now);
  if (wait > 0 && !(final && ownKept)) {
    if (remember) deferred.set(cardId, { owner, paths: unique, at: now });
    return { refreshed: false, retryInMs: wait };
  }
  const account = hourAt(accountHours.get(owner), now);
  siteHour = hourAt(siteHour, now);
  const spent =
    account.count + unique.size > DROPS_PER_ACCOUNT_HOUR
      ? `the account's hour of page drops is spent (${DROPS_PER_ACCOUNT_HOUR})`
      : siteHour.count + unique.size > DROPS_PER_SITE_HOUR
        ? `the site's hour of the cabinet's page drops is spent (${DROPS_PER_SITE_HOUR})`
        : null;
  deferred.delete(cardId);
  if (spent) {
    console.warn(`[card-page] ${spent}: the card's page is not dropped`, { cardId, paths: unique.size });
    return { refreshed: false };
  }
  for (const path of unique) revalidatePath(path);
  account.count += unique.size;
  accountHours.set(owner, account);
  siteHour.count += unique.size;
  lastDropAt.set(cardId, now);
  return { refreshed: true };
}

/**
 * Drop the page of a card the partner just wrote: its address (and, when the
 * write moved it, the previous one) from the API's answer, with the drop of
 * it deferred before, if any. `card.partner_id` — the owner as the API
 * answered: without it nothing is dropped. `requireActive` — only a published
 * card has a page a guest sees; the pause drops a card that has just stopped
 * being one (a pause the interval deferred is taken by refresh-page later,
 * from what was remembered — the card no longer active by then).
 *
 * The site's list of the cards' own addresses (lib/known-slugs) learns the
 * address of a published card here at once: a card the save moved is not
 * sent back to its old address by a list read before the save (MEDIUM 3 of
 * Phase 4.5 — the new and the old address sent the guest to each other while
 * the list was older than the move and the hour's asks were spent).
 */
export async function refreshCardPage(
  cardId: string,
  card: CardAddressSource,
  {
    final = false,
    remember = true,
    requireActive = true,
    previous,
  }: {
    final?: boolean;
    /** false — not a write (refresh-page): a deferral of it leaves nothing to remember. */
    remember?: boolean;
    requireActive?: boolean;
    previous?: CardAddressSource | null;
  } = {},
): Promise<PageRefresh> {
  const owner = card.partner_id;
  if (typeof owner !== 'string' || owner === '') return { refreshed: false };
  const active = card.status === 'active';
  const paths: string[] = [];
  if (active || !requireActive) {
    const path = await cardPagePath(card);
    if (path) {
      paths.push(path);
      if (active && typeof card.slug === 'string') noteCardAddress(card.slug, path);
      if (previous) {
        // The previous city and category, with this card's own slug: only an
        // address of this card in the canonical form can come out of it.
        const before = await cardPagePath({ ...previous, slug: card.slug });
        if (before && before !== path) paths.push(before);
      }
    }
  }
  return dropCardPaths(owner, cardId, paths, { final, remember });
}

/** Test-only: forget every drop. */
export function _resetForTests(): void {
  lastDropAt = new Map();
  accountHours = new Map();
  siteHour = { start: 0, count: 0 };
  deferred = new Map();
}
