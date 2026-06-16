import { HOURS_VALUES } from '@/lib/facets';

/*
 * Shared search-param parsing for the results pages — catalog (/[city]/[category])
 * and city (/[city]). The URL query-string is the single source of truth for
 * filters: FilterShelf mutates it, the Server Component re-fetches. Extracted so
 * both pages parse identically AND so the SEO noindex predicate (hasAnyFilter)
 * lives in ONE place. These are byte-for-byte the helpers the catalog page has
 * shipped since Brief 3 — relocated, not changed.
 */

export type HoursBucket = 'until_22' | 'until_morning' | '24_hours';

export type SearchParams = { [key: string]: string | string[] | undefined };

export function parsePage(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
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
    Boolean(asHours(sp.hours)) ||
    Boolean(asString(sp.minRating)) ||
    Boolean(asString(sp.search)) ||
    Boolean(asString(sp.sort_by))
  );
}
