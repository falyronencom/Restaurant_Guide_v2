import { PRICE_VALUES } from './facets';

/*
 * buildResultsHref — target URL for the mobile filter drawer's «Применить»
 * (batch model). ONE navigation commits the whole local selection at once,
 * unlike the desktop shelf which navigates live on every toggle.
 *
 * The contract mirrors BOTH the live desktop path (FilterShelf.navigate:
 * preserve sibling params, drop `page`) AND the home search (HeroSearch.onSubmit:
 * category → SEO path segment, omit-when-all for OR-within facets):
 *
 *   • Category → the PATH: chosen → /{city}/{category}, none → /{city}. It is a
 *     route segment, never a query param.
 *   • cuisine / priceRange (OR-within-group): comma-joined; omitted when NONE or
 *     ALL are selected ("all" == no constraint).
 *   • features (AND-between): comma-joined; omitted only when none is selected
 *     ("all" is a real, maximally-restrictive filter — NOT collapsed away).
 *   • hours: single bucket.
 *   • `page` is always dropped (a filter change returns to page 1). Every OTHER
 *     current param (search / sort_by / minRating / view / focus …) is preserved
 *     verbatim, exactly as the live desktop toggle carries its siblings along.
 */

const FACET_KEYS = new Set(['cuisine', 'priceRange', 'features', 'hours', 'page']);

type Selected = {
  cuisines: string[];
  priceRange: string[];
  features: string[];
  hours: string | undefined;
};

export function buildResultsHref({
  citySlug,
  categorySlug,
  selected,
  searchParams,
  cuisineCount,
}: {
  citySlug: string;
  categorySlug: string | undefined;
  selected: Selected;
  searchParams: Record<string, string | string[] | undefined>;
  /** Size of the cuisine vocabulary — needed for the OR-within "all" check. */
  cuisineCount: number;
}): string {
  const params = new URLSearchParams();

  // Carry every non-facet, non-page sibling through unchanged (search, sort_by,
  // minRating, view, focus, …) — the facet keys below are rebuilt from `selected`.
  for (const [key, value] of Object.entries(searchParams)) {
    if (FACET_KEYS.has(key)) continue;
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }

  // OR-within-group: omit when none OR all selected ("all" == no constraint).
  if (
    selected.cuisines.length > 0 &&
    selected.cuisines.length < cuisineCount
  ) {
    params.set('cuisine', selected.cuisines.join(','));
  }
  if (
    selected.priceRange.length > 0 &&
    selected.priceRange.length < PRICE_VALUES.length
  ) {
    params.set('priceRange', selected.priceRange.join(','));
  }
  // AND-between: keep even when all selected; omit only when empty.
  if (selected.features.length > 0) {
    params.set('features', selected.features.join(','));
  }
  if (selected.hours) params.set('hours', selected.hours);

  const qs = params.toString();
  const base = categorySlug ? `/${citySlug}/${categorySlug}` : `/${citySlug}`;
  return qs ? `${base}?${qs}` : base;
}
