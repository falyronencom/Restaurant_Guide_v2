import 'server-only';

import { cache } from 'react';

import { serverFetch } from '../client';
import type { MetadataSlug, PaginationMeta, PublicMetadata } from '../types';

/**
 * GET /api/v1/public/metadata
 *
 * Returns slug↔name pairs for cities, categories, cuisines. Pure data,
 * no DB query — strong cache candidate.
 *
 * Wrapped in `React.cache` so multiple call sites within the same request
 * (e.g. page + generateMetadata + validateCitySlug + validateCategorySlug)
 * share a single fetch — per Next docs §Metadata#memoizing-data-requests.
 */
export const getMetadata = cache(async (): Promise<PublicMetadata> => {
  return serverFetch<PublicMetadata>('/api/v1/public/metadata');
});

/**
 * Cities the visitor is offered — the metadata set narrowed to cities that
 * have at least one active establishment (Coordinator decision 01.10, А2).
 *
 * The metadata list is a backend constant (7 cities) while the catalog lives
 * in Минск only; offering Гродно led to an empty page. Every visible city
 * choice (footer links, the hero and catalog city pickers, the home category
 * tiles, the sitemap) goes through this list, so a city appears on its own
 * once its first card is published — no code change (within the probe window).
 *
 * Probe: one `limit=1` catalog request per city, cached in the Next data
 * cache for CITY_PROBE_REVALIDATE_S so force-dynamic pages do not spend 7
 * backend calls per render against the per-IP rate limit.
 *
 * The window must NOT be shorter than the ISR window of the (public) routes
 * (3600 s — layout, home, detail, sitemap): the probe runs in the shared
 * (public) layout, and Next lowers a route's revalidate to the lowest
 * fetch-level revalidate it renders. A 600 s probe turned every static page
 * into a 10-minute one — and each regeneration of a detail page calls
 * by-slug, which counts a view in the partner's statistics (review 01.10).
 *
 * Degradation: a city whose probe FAILS is kept (unknown ≠ empty — the old
 * behaviour); if every city reports zero (empty catalog) the full list is
 * returned so the pickers never render empty.
 *
 * URL validity is NOT narrowed: `/grodno` stays a valid page (validateCitySlug
 * uses the full set) and shows an honest «пока нет заведений» state.
 */
export const CITY_PROBE_REVALIDATE_S = 3600;

export const getLiveCities = cache(async (): Promise<MetadataSlug[]> => {
  const { cities } = await getMetadata();
  const probes = await Promise.allSettled(
    cities.map((c) =>
      serverFetch<{ pagination: PaginationMeta }>(
        `/api/v1/public/establishments?city=${encodeURIComponent(c.slug)}&limit=1`,
        { next: { revalidate: CITY_PROBE_REVALIDATE_S } },
      ),
    ),
  );
  const live = cities.filter((_, i) => {
    const probe = probes[i];
    return probe.status === 'rejected' || probe.value.pagination.total > 0;
  });
  return live.length > 0 ? live : cities;
});

/**
 * Whether a city has at least one active establishment (see getLiveCities).
 */
export async function isLiveCity(citySlug: string): Promise<boolean> {
  const live = await getLiveCities();
  return live.some((c) => c.slug === citySlug);
}

/**
 * Validate that a city slug is in the known set.
 *
 * Used in page route handlers before delegating to catalog fetches; lets
 * callers `notFound()` early for unknown cities without burning a downstream
 * 400 from the catalog endpoint.
 */
export async function validateCitySlug(citySlug: string): Promise<boolean> {
  const meta = await getMetadata();
  return meta.cities.some((c) => c.slug === citySlug);
}

/**
 * Validate that a category slug is in the known set. Symmetric to
 * `validateCitySlug`; lets `/{city}/{category}` page route 404 early
 * for unknown categories.
 */
export async function validateCategorySlug(
  categorySlug: string,
): Promise<boolean> {
  const meta = await getMetadata();
  return meta.categories.some((c) => c.slug === categorySlug);
}
