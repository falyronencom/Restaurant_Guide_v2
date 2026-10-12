import type { MetadataSlug } from '@/lib/api/types';
import { HOURS_VALUES } from '@/lib/facets';

/*
 * Shared search-param parsing for the results pages — catalog (/[city]/[category])
 * and city (/[city]). The URL query-string is the single source of truth for
 * filters: FilterShelf mutates it, the Server Component re-fetches. Extracted so
 * both pages parse identically AND so the SEO noindex predicate (hasAnyFilter)
 * lives in ONE place. The parsers are the helpers the catalog page has shipped
 * since Brief 3 — relocated, not changed, save the page ceiling parsePage gained
 * on 12.10 (MAX_PAGE; the all-reviews page reads its ?page through it too);
 * acceptedSearchParams (below) narrows the query to what the backend accepts
 * before they read it.
 */

export type HoursBucket = 'until_22' | 'until_morning' | '24_hours';

export type SearchParams = { [key: string]: string | string[] | undefined };

/*
 * The highest page a URL can ask for. A larger number is not a page of any
 * listing that can exist, so it reads like `?page=abc` — page 1. By data:
 * 10 000 pages hold 200 000 cards at the catalog's 20 a page (all of Belarus's
 * catering is 16 699 places — Belstat, 1.01.2026; Minsk 4 583) and 100 000
 * reviews of one place at the reviews page's 10. A page past the listing's last
 * stays honestly empty, as before.
 *
 * Without the ceiling a huge number took the page to the error screen (12.10,
 * /minsk?page=100000000000000000000): the backend's OFFSET, (page − 1) × limit,
 * outgrows the database's bigint from about page 4.6·10^17 — a 500, and a 400
 * once the number is long enough for JavaScript to print it in exponent form.
 */
export const MAX_PAGE = 10_000;

export function parsePage(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1 || n > MAX_PAGE) return 1;
  return n;
}

export function asString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export function asFloat(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

// Multi-value facet: comma-joined ('a,b') — the shelf's URL contract — robust to
// array-form (?k=a&k=b) too; returns trimmed non-empty values.
export function asList(raw: unknown): string[] {
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// Narrow the single working-hours param to a known bucket; unknown → undefined
// (mirrors the backend's soft-ignore of an unrecognized hours value).
export function asHours(raw: unknown): HoursBucket | undefined {
  return typeof raw === 'string' && HOURS_VALUES.includes(raw)
    ? (raw as HoursBucket)
    : undefined;
}

// Any active facet/sort/search param → noindex this permutation (CAT-C-2.3),
// consolidated onto the clean URL via canonical. `page` is deliberately excluded
// — paginated URLs stay indexable. Symmetric with how the page body parses
// filters. Both the catalog and city results pages gate noindex on this.
export function hasAnyFilter(sp: SearchParams): boolean {
  return (
    asList(sp.cuisine).length > 0 ||
    asList(sp.priceRange).length > 0 ||
    asList(sp.features).length > 0 ||
    Boolean(asHours(sp.hours)) ||
    Boolean(asString(sp.minRating)) ||
    Boolean(asString(sp.search)) ||
    Boolean(asString(sp.sort_by))
  );
}

/*
 * The query narrowed to values the backend accepts. Both results pages apply it
 * once per request, before anything reads the params: the list fetch, the
 * shelf's selection, every link built from them (pagination, sort, search,
 * filters) and the map island, which receives them as a prop. (The list/map
 * toggle builds its link from the browser's own query, so a dropped value can
 * ride along a toggle — harmless: the next render narrows it again.)
 *
 * Two values took the whole page down (01.10, /minsk?cuisine=nonexistent-xyz):
 *   • cuisine — the backend answers 400 INVALID_SLUG on a slug it cannot
 *     translate. Kept: the slugs the metadata lists, matched regardless of case
 *     (as the backend matches) and spelt as the metadata spells them, so the
 *     shelf shows them selected.
 *   • minRating — the backend answers 422 outside 1–5.
 * And one character did (12.10, /minsk?priceRange=%00, ?search=%00): NUL. The
 * database cannot store it in text, so a value carrying it is a 500 wherever it
 * reaches a query. Every value first loses its control characters — U+0000–
 * U+001F and U+007F, the set the smart endpoint strips from a phrase
 * (smartSearchController sanitizeQuery), so the classic fallback searches the
 * same words — and a key left with no value is dropped.
 * A dropped value is soft-ignored, as the backend soft-ignores an unknown
 * amenity or hours value: a stale or mistyped facet URL renders the catalog
 * without that filter. Every other key passes through otherwise untouched, in
 * its place. generateMetadata keeps reading the raw query, so such a URL stays
 * noindex with its canonical on the clean address.
 */
export function acceptedSearchParams(
  sp: SearchParams,
  cuisines: readonly MetadataSlug[],
): SearchParams {
  const accepted: SearchParams = {};
  for (const [key, raw] of Object.entries(sp)) {
    const value = withoutControlChars(raw);
    if (value === undefined) continue;
    if (key === 'cuisine') {
      const known = asList(value).flatMap((slug) => {
        const hit = cuisines.find(
          (c) => c.slug.toLowerCase() === slug.toLowerCase(),
        );
        return hit ? [hit.slug] : [];
      });
      if (known.length > 0) accepted.cuisine = known.join(',');
    } else if (key === 'minRating') {
      const rating = asFloat(value);
      if (rating !== undefined && rating >= 1 && rating <= 5) {
        accepted.minRating = value;
      }
    } else {
      accepted[key] = value;
    }
  }
  return accepted;
}

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

// The value without its control characters; undefined when nothing is left
// (an array keeps its non-empty items).
function withoutControlChars(
  value: SearchParams[string],
): SearchParams[string] {
  if (typeof value === 'string') {
    const clean = value.replace(CONTROL_CHARS, '');
    return clean === '' ? undefined : clean;
  }
  if (Array.isArray(value)) {
    const clean = value
      .map((item) => item.replace(CONTROL_CHARS, ''))
      .filter((item) => item !== '');
    return clean.length > 0 ? clean : undefined;
  }
  return undefined;
}
