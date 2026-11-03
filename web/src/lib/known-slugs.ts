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

/** slug → the card's own address, from the catalogue. */
let list: { paths: Map<string, string>; at: number } | null = null;
let lastReadAt = 0;
let reading: Promise<void> | null = null;
let misses = { start: 0, count: 0 };

async function readList(): Promise<void> {
  lastReadAt = Date.now();
  try {
    const paths = new Map<string, string>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { establishments, pagination } = await getCatalog({ limit: PAGE_LIMIT, page });
      for (const est of establishments) paths.set(est.slug, establishmentAddress(est).path);
      if (!pagination.hasNext) break;
    }
    list = { paths, at: Date.now() };
  } catch {
    // Keep the list we had; without one, every well-formed slug is asked.
  }
}

function readListOnce(): Promise<void> {
  if (!reading) reading = readList().finally(() => { reading = null; });
  return reading;
}

function takeMiss(): boolean {
  const now = Date.now();
  if (now - misses.start >= HOUR_MS) misses = { start: now, count: 0 };
  misses.count += 1;
  return misses.count <= MISSES_PER_HOUR;
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
  const now = Date.now();
  if (!list || now - list.at >= LIST_TTL_MS) {
    if (now - lastReadAt >= REFRESH_MIN_MS) await readListOnce();
  }
  if (!list) return { kind: 'ask' };
  if (!list.paths.has(slug) && Date.now() - lastReadAt >= REFRESH_MIN_MS) {
    await readListOnce();
  }
  const own = list.paths.get(slug);
  if (own === path) return { kind: 'ask' };
  if (takeMiss()) return { kind: 'ask' };
  return own ? { kind: 'redirect', path: own } : { kind: 'not-found' };
}

/** Test-only: forget the list and the allowance. */
export function _resetForTests(): void {
  list = null;
  lastReadAt = 0;
  reading = null;
  misses = { start: 0, count: 0 };
}
