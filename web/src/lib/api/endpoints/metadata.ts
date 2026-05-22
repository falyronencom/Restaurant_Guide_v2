import 'server-only';

import { cache } from 'react';

import { serverFetch } from '../client';
import type { PublicMetadata } from '../types';

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
