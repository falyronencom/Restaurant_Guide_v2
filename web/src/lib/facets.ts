/*
 * Filter-shelf facet vocabularies (Phase A + Segment D attributes).
 *
 * Local source for the price-range, working-hours-bucket, and attribute facets.
 * The public /metadata endpoint exposes ONLY cities/categories/cuisines, so
 * these option lists are mirrored here from the backend validators
 * (backend/src/validators/searchValidation.js) and the mobile filter screen
 * (mobile/lib/models/filter_options.dart).
 *
 * The cuisine facet is intentionally NOT here — its vocabulary is fetched from
 * the metadata API (PublicMetadata.cuisines, { slug, name } pairs).
 *
 * ATTRIBUTE_OPTIONS mirrors the REAL attribute data canon — the 9 reader/writer
 * keys (web establishment-helpers ATTRIBUTE_ORDER + partner constants
 * ATTRIBUTES), which is exactly what the public catalog backend now validates
 * (publicController VALID_FEATURES). NOT the geo-search validator's 8 keys:
 * those use smoking_area/pet_friendly (absent from real data) and omit
 * live_music, so filtering by them would be a dead facet.
 *
 * `value` is the raw query-param value the backend expects and the value stored
 * in the URL searchParam: price '$' / '$$' / '$$$' pass through unchanged;
 * hours buckets match the searchWithoutLocation bucket switch exactly; feature
 * keys pass through verbatim (single name `features` across URL/getCatalog/
 * backend). Labels are Russian.
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

/**
 * Attribute (amenity) facet. Multi-select, AND-between (the backend adds one
 * (attributes->>key)::boolean=true condition per key). Keys + order match the
 * web reader canon (establishment-helpers ATTRIBUTE_ORDER) so the facet labels
 * agree with what the detail page shows; the public catalog backend validates
 * exactly these keys (publicController VALID_FEATURES).
 */
export const ATTRIBUTE_OPTIONS: readonly FacetOption[] = [
  { value: 'delivery', label: 'Доставка еды' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'terrace', label: 'Летняя терраса' },
  { value: 'parking', label: 'Парковка' },
  { value: 'live_music', label: 'Живая музыка' },
  { value: 'kids_zone', label: 'Детская зона' },
  { value: 'banquet', label: 'Банкет' },
  { value: 'pets_allowed', label: 'Можно с животными' },
  { value: 'smoking', label: 'Зал для курящих' },
] as const;

/** Flat value lists — handy for parse-time membership checks. */
export const PRICE_VALUES: readonly string[] = PRICE_OPTIONS.map((o) => o.value);
export const HOURS_VALUES: readonly string[] = HOURS_OPTIONS.map((o) => o.value);
export const ATTRIBUTE_VALUES: readonly string[] = ATTRIBUTE_OPTIONS.map((o) => o.value);
