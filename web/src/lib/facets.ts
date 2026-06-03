/*
 * Filter-shelf facet vocabularies (Phase A).
 *
 * Local source for the price-range and working-hours-bucket facets. The public
 * /metadata endpoint exposes ONLY cities/categories/cuisines, so these two
 * option lists are mirrored here from the backend validators
 * (backend/src/validators/searchValidation.js) and the mobile filter screen
 * (mobile/lib/models/filter_options.dart).
 *
 * The cuisine facet is intentionally NOT here — its vocabulary is fetched from
 * the metadata API (PublicMetadata.cuisines, { slug, name } pairs).
 *
 * `value` is the raw query-param value the backend expects and the value stored
 * in the URL searchParam: price '$' / '$$' / '$$$' pass through unchanged;
 * hours buckets match the searchWithoutLocation bucket switch exactly. Labels
 * are Russian, ported from the mobile filter screen.
 */

export type FacetOption = {
  /** Raw value sent to the backend and persisted in the URL searchParam. */
  value: string;
  /** Russian display label. */
  label: string;
};

/** Price-range buckets ($ / $$ / $$$). Multi-select, OR-within-group. */
export const PRICE_OPTIONS: readonly FacetOption[] = [
  { value: '$', label: '$ · до 20 руб' },
  { value: '$$', label: '$$ · до 50 руб' },
  { value: '$$$', label: '$$$ · более 50 руб' },
] as const;

/**
 * Working-hours buckets. Single-select. Absolute/static — each bucket is
 * derived from the establishment's stored working_hours (NOT the current
 * time), so the resulting URLs are stable and cacheable. Values MUST match
 * the backend bucket switch in searchWithoutLocation exactly.
 */
export const HOURS_OPTIONS: readonly FacetOption[] = [
  { value: 'until_22', label: 'До 22:00' },
  { value: 'until_morning', label: 'До утра' },
  { value: '24_hours', label: 'Круглосуточно' },
] as const;

/** Flat value lists — handy for parse-time membership checks. */
export const PRICE_VALUES: readonly string[] = PRICE_OPTIONS.map((o) => o.value);
export const HOURS_VALUES: readonly string[] = HOURS_OPTIONS.map((o) => o.value);
