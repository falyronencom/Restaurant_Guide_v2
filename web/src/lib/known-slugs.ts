import 'server-only';

import { getCatalog } from '@/lib/api/endpoints/establishments';
import { establishmentAddress } from '@/lib/establishment-path';

/*
 * Whether the detail page may ask the API for a card by its slug (thread
 * «Расходы посторонних», point 5, 03.11.2026).
 *
 * The detail page is ISR: its calls to the API carry no visitor and spend the
 * site's own budget there (lib/api/visitor.ts). A path never rendered before
 * is rendered on demand, so until now every made-up slug — and every card
 * under each of the other cities and categories — cost one call from that
 * budget, and once it was spent, the cards not cached yet failed to open for
 * everyone. Now the page asks the API only when:
 *   - the slug has the form the API gives slugs (utils/slugGenerator.js:
 *     lowercase Latin letters and digits joined by single hyphens, at most
 *     150) — otherwise «not found»;
 *   - and the path is the card's own address in the catalogue — the list of
 *     the catalogue's cards, read in pages like the sitemap, kept for
 *     LIST_TTL_MS and read anew on a miss at most once per REFRESH_MIN_MS;
 *   - or, otherwise, while the hour's allowance of such asks lasts
 *     (MISSES_PER_HOUR): a card approved or moved since the last read is
 *     answered by the API itself, as before. Past the allowance a slug not in
 *     the list is «not found» unasked, and a card's foreign address
 *     redirects to its own from the list.
 * The list could not be read — every well-formed slug is asked about, as
 * before. Per instance; the list costs a few calls at most once a minute.
 */

const SLUG_FORM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 150;
const LIST_TTL_MS = 10 * 60 * 1000;
const REFRESH_MIN_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
export const MISSES_PER_HOUR = 120;
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

export type SlugVerdict =
  | { kind: 'ask' }
  | { kind: 'not-found' }
  | { kind: 'redirect'; path: string };

/**
 * The list and the allowance live on globalThis, not in this module. The
 * site's server bundles the card page's render and the cabinet's Route
 * Handlers apart, each with its own copy of this module: a list kept in the
 * module was the page's alone, and the cabinet's noteCardAddress corrected a
 * copy no page read (seen on the stand, 23.11.2026 — a moved card's new and
 * old address kept sending the guest to each other). One process, one list.
 */
type KnownSlugs = {
  /** slug → the card's own address, from the catalogue. */
  list: { paths: Map<string, string>; at: number } | null;
  lastReadAt: number;
  reading: Promise<void> | null;
  /** The cabinet's notes made while a read of the list is under way: laid over what it read. */
  notedDuringRead: Map<string, string> | null;
  misses: { start: number; count: number };
};

const STATE = Symbol.for('nirivio.known-slugs');

function fresh(): KnownSlugs {
  return { list: null, lastReadAt: 0, reading: null, notedDuringRead: null, misses: { start: 0, count: 0 } };
}

function state(): KnownSlugs {
  const store = globalThis as unknown as Record<symbol, KnownSlugs | undefined>;
  return (store[STATE] ??= fresh());
}

async function readList(): Promise<void> {
  const s = state();
  s.lastReadAt = Date.now();
  s.notedDuringRead = new Map();
  try {
    const paths = new Map<string, string>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { establishments, pagination } = await getCatalog({ limit: PAGE_LIMIT, page });
      for (const est of establishments) paths.set(est.slug, establishmentAddress(est).path);
      if (!pagination.hasNext) break;
    }
    for (const [slug, path] of s.notedDuringRead ?? []) paths.set(slug, path);
    s.list = { paths, at: Date.now() };
  } catch {
    // Keep the list we had; without one, every well-formed slug is asked.
  } finally {
    s.notedDuringRead = null;
  }
}

function readListOnce(): Promise<void> {
  const s = state();
  if (!s.reading) {
    s.reading = readList().finally(() => {
      s.reading = null;
    });
  }
  return s.reading;
}

function takeMiss(): boolean {
  const s = state();
  const now = Date.now();
  if (now - s.misses.start >= HOUR_MS) s.misses = { start: now, count: 0 };
  s.misses.count += 1;
  return s.misses.count <= MISSES_PER_HOUR;
}

export function hasSlugForm(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && SLUG_FORM.test(slug);
}

/**
 * What the detail page does with a request for `slug` under `path`
 * (/{city}/{category}/{slug}): ask the API, answer «not found», or redirect to
 * the card's own address — the last two without a call.
 */
export async function slugVerdict(slug: string, path: string): Promise<SlugVerdict> {
  if (!hasSlugForm(slug)) return { kind: 'not-found' };
  const s = state();
  const now = Date.now();
  if (!s.list || now - s.list.at >= LIST_TTL_MS) {
    if (now - s.lastReadAt >= REFRESH_MIN_MS) await readListOnce();
  }
  const list = s.list;
  if (!list) return { kind: 'ask' };
  if (!list.paths.has(slug) && Date.now() - s.lastReadAt >= REFRESH_MIN_MS) {
    await readListOnce();
  }
  const own = (s.list ?? list).paths.get(slug);
  if (own === path) return { kind: 'ask' };
  if (takeMiss()) return { kind: 'ask' };
  return own ? { kind: 'redirect', path: own } : { kind: 'not-found' };
}

/**
 * A card's own address as the API has just answered it to the card's partner
 * (lib/partner/card-page, after a write from the cabinet): the list learns it
 * at once. Without this, a card whose save moved it (another city, another
 * first category) kept its old address here until the list was read anew:
 * once the hour's asks were spent the new address redirected to the old one,
 * and the old one — dropped by the save — to the new one. No list yet — no
 * list to correct: every well-formed slug is asked about.
 */
export function noteCardAddress(slug: string, path: string): void {
  const s = state();
  if (!hasSlugForm(slug)) return;
  s.notedDuringRead?.set(slug, path);
  s.list?.paths.set(slug, path);
}

/** Test-only: forget the list and the allowance. */
export function _resetForTests(): void {
  const store = globalThis as unknown as Record<symbol, KnownSlugs | undefined>;
  store[STATE] = fresh();
}
