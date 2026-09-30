import 'server-only';

import {
  getCatalog,
  type CatalogParams,
  type CatalogResponse,
} from '@/lib/api/endpoints/establishments';
import {
  smartSearch,
  type SmartSearchBody,
  type SmartSearchIntent,
} from '@/lib/api/endpoints/search';
import {
  ApiError,
  type MetadataSlug,
  type PublicEstablishmentListing,
  type PublicEstablishmentMapMarker,
  type PublicMetadata,
} from '@/lib/api/types';
import { ATTRIBUTE_VALUES } from '@/lib/facets';

/*
 * «Текст в строке поиска ищет умно» — on the web, as on mobile since 07.09.
 *
 * A results page (/[city], /[city]/[category]) whose URL carries `search`
 * gets its list from the smart endpoint (the mobile search bar's engine:
 * dishes in menus, meal types, amenities from the phrase, a named
 * establishment first). Without a phrase — the classic public catalog,
 * byte-for-byte as before. Mobile's rule is the same: the text field decides
 * the endpoint.
 *
 * The page never fails because of the smart path. If the smart endpoint does
 * not answer (timeout, 5xx, or 429 — every web visitor reaches the backend
 * from the web server's one address, so the per-IP smart limit is shared
 * site-wide), the page falls back to the classic text search it has always
 * run.
 */

export type CatalogResults = CatalogResponse & {
  /**
   * How the phrase was understood («бургер · недорого») for the line above
   * the results; null without a phrase, on any fallback, or when the parse
   * holds nothing worth showing.
   */
  understood: string | null;
  /**
   * The order the phrase asked for — the list's real order while the visitor
   * has not chosen one («недорого» → 'price_asc'); feeds the sort select.
   * Only orders the site offers: «рядом» has no location to sort by here.
   */
  sortFromPhrase: 'rating' | 'price_asc' | null;
};

/** The smart endpoint's own page-size ceiling (smartSearchController clamps limit to 100). */
export const SMART_SEARCH_MAX_LIMIT = 100;

/**
 * List results for a results page. Takes the page's own catalog params (URL
 * slugs) and the request's metadata (already fetched for slug validation).
 */
export async function getCatalogResults(
  params: CatalogParams,
  meta: PublicMetadata,
): Promise<CatalogResults> {
  const body = toSmartSearchBody(params, meta);
  if (body) {
    try {
      const smart = await smartSearch(body);
      return {
        establishments: smart.establishments,
        pagination: smart.pagination,
        // A backend fallback (fallback:true — the phrase was searched as raw
        // text) arrives with intent null, so there is nothing to show.
        understood: describeIntent(smart.intent),
        sortFromPhrase: sortFromPhrase(smart.intent),
      };
    } catch (err) {
      logFallback('list', err);
    }
  }
  const catalog = await getCatalog(params);
  return { ...catalog, understood: null, sortFromPhrase: null };
}

function sortFromPhrase(
  intent: SmartSearchIntent | null,
): CatalogResults['sortFromPhrase'] {
  const sort = intent?.sort;
  return sort === 'rating' || sort === 'price_asc' ? sort : null;
}

/**
 * Markers for the results map when a phrase is active, or null when the map
 * should take its classic path (no phrase, an untranslatable slug, or the smart
 * endpoint failed).
 *
 * The phrase map shows the phrase's whole result set — the same establishments
 * as the list — not a viewport box: the smart endpoint has no bounds, and a map
 * that re-queried per camera move would disagree with the list (classic text
 * search finds 0 for «терраса», the list 19) and spend the shared smart limit.
 * The set is capped at the endpoint's ceiling of 100.
 */
export async function getPhraseMapMarkers(
  params: CatalogParams,
  meta: PublicMetadata,
): Promise<PublicEstablishmentMapMarker[] | null> {
  const body = toSmartSearchBody(
    { ...params, page: 1, limit: SMART_SEARCH_MAX_LIMIT },
    meta,
  );
  if (!body) return null;
  try {
    const smart = await smartSearch(body);
    return smart.establishments.map(toMapMarker);
  } catch (err) {
    logFallback('map', err);
    return null;
  }
}

/**
 * The web's catalog params (URL slugs) → the smart endpoint body (the
 * backend's Cyrillic values), or null when there is no phrase or a slug does
 * not translate. On null the caller keeps the classic path, which answers such
 * a URL exactly as it always has (an unknown cuisine slug stays a 400 there).
 *
 * Untouched filters stay undefined, so they never reach the wire
 * (JSON.stringify drops them) — see SmartSearchBody.
 */
export function toSmartSearchBody(
  params: CatalogParams,
  meta: PublicMetadata,
): SmartSearchBody | null {
  const query = params.search?.trim();
  if (!query) return null;

  const city = params.city ? nameOf(meta.cities, params.city) : undefined;
  if (params.city && !city) return null;

  const category = params.category
    ? nameOf(meta.categories, params.category)
    : undefined;
  if (params.category && !category) return null;

  const cuisines: string[] = [];
  for (const slug of params.cuisines ?? []) {
    const name = nameOf(meta.cuisines, slug);
    if (!name) return null;
    cuisines.push(name);
  }

  // The public catalog soft-ignores an unknown amenity key (a stale facet URL
  // still renders); the smart endpoint would apply it as a real filter no card
  // satisfies. Same soft-ignore here, so the two paths agree on such a URL.
  const features = (params.features ?? []).filter((key) =>
    ATTRIBUTE_VALUES.includes(key),
  );

  return {
    query,
    city,
    categories: category ? [category] : undefined,
    cuisines: cuisines.length > 0 ? cuisines : undefined,
    priceRange:
      params.priceRange && params.priceRange.length > 0
        ? params.priceRange
        : undefined,
    features: features.length > 0 ? features : undefined,
    minRating: params.minRating,
    hours_filter: params.hours_filter,
    sort_by: params.sort_by,
    page: params.page,
    limit: params.limit,
  };
}

/**
 * The parse, in words — the rule of the mobile preview header
 * (SmartSearchIntent.toDisplayString): dish first, then type, cuisines,
 * budget, the city named in the phrase, and the order the phrase asked for.
 * Meal type and amenity words are not shown there either.
 *
 * One deliberate difference: no «рядом с вами». The site has no visitor
 * location, so a phrase asking for «рядом» cannot be ordered by distance here
 * and the words would promise what the list does not do.
 */
export function describeIntent(
  intent: SmartSearchIntent | null,
): string | null {
  if (!intent) return null;
  const parts: string[] = [];
  if (intent.dish) parts.push(intent.dish);
  if (intent.category) parts.push(intent.category);
  if (intent.cuisine && intent.cuisine.length > 0) {
    parts.push(intent.cuisine.join(', '));
  }
  // `${20}` prints «20», `${19.5}` «19.5» — mobile's _formatPrice by default.
  if (intent.price_max != null) parts.push(`до ${intent.price_max} BYN`);
  if (intent.location) parts.push(intent.location);
  const sortWord = intent.sort ? SORT_WORDS[intent.sort] : undefined;
  if (sortWord) parts.push(sortWord);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const SORT_WORDS: Record<string, string> = {
  rating: 'лучшие',
  price_asc: 'недорого',
};

/** Listing row → map marker: the marker projection is a subset of the listing one. */
export function toMapMarker(
  e: PublicEstablishmentListing,
): PublicEstablishmentMapMarker {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    city: e.city,
    city_slug: e.city_slug,
    address: e.address,
    categories: e.categories,
    category_slug: e.category_slug,
    price_range: e.price_range,
    latitude: e.latitude,
    longitude: e.longitude,
    primary_image_url: e.primary_image_url,
    review_count: e.review_count,
    average_rating: e.average_rating,
    has_promotion: e.has_promotion,
  };
}

function nameOf(list: MetadataSlug[], slug: string): string | undefined {
  return list.find((item) => item.slug === slug)?.name;
}

/*
 * A fallback is logged without the phrase: the visitor's words stay out of the
 * web logs (the backend keeps them only for zero-result searches). The status
 * is enough to tell the shared per-IP limit (429) from a timeout (0) or an
 * outage (5xx).
 */
function logFallback(surface: 'list' | 'map', err: unknown): void {
  const status = err instanceof ApiError ? err.statusCode : 'unknown';
  console.warn(
    `[smart-search] ${surface}: smart endpoint failed (status ${status}), classic search used`,
  );
}
