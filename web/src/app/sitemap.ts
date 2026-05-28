import type { MetadataRoute } from 'next';

import { getCatalog } from '@/lib/api/endpoints/establishments';
import { getMetadata } from '@/lib/api/endpoints/metadata';
import { isNoIndexMode, toAbsoluteUrl } from '@/lib/seo-gate';

/**
 * `app/sitemap.ts` — Sitemap XML endpoint at `/sitemap.xml`.
 *
 * Gate layer 2 (CAT-C-1.2): when `NOINDEX_MODE` is engaged we return an
 * empty array — Next 16 docs do NOT document `notFound()` from sitemap.ts
 * (Discovery Q8a SR finding), so empty array is the canonical "no URLs"
 * form. Zero URLs leak.
 *
 * When the gate is off, the sitemap enumerates four URL tiers:
 *   1. Home              — 1 URL
 *   2. City pages        — 7 URLs (Mogilev ё/е deduplicated by backend metadata)
 *   3. City × Category   — ~105 URLs (7 cities × 15 categories)
 *   4. Establishment slugs — paginated `getCatalog` enumeration (~1500 URLs)
 *
 * Defensive try/catch around catalog pagination: sitemap.ts lives OUTSIDE
 * the `(public)/error.tsx` boundary (Discovery F6), so a fetch failure
 * would otherwise crash the endpoint entirely. On failure we degrade to
 * tier 1+2+3 only — base URLs always reachable.
 *
 * Per Brief 5 sitemap decisions (Trunk locked):
 *   - All four tiers, single file (~1600 URLs ≪ Google's 50k limit)
 *   - ISR revalidate=3600 (one-hour staleness window acceptable)
 *   - Only active establishments (publicService enforces server-side —
 *     sitemap is consumer-blind on status filter)
 *   - No completeness gate (locked decision)
 *
 * Per Discovery F4: enumeration uses paginated catalog (~15 fetches at
 * limit=100). Sitemap-builder via getCatalog does NOT trigger view_count
 * side-effect (publicService.assembleEstablishmentDetail is by-slug only).
 *
 * Per Discovery F3: legacy English seed values produce null city_slug /
 * category_slug at projection layer. Sitemap has no page params for
 * fallback, so we skip such rows rather than fabricate URLs that wouldn't
 * resolve cleanly. Detail catalog page routes handle the fallback for live
 * navigation; sitemap stays honest.
 *
 * Next 16 Route Handler — cached by default; revalidates per ISR window.
 */

export const revalidate = 3600;

const CATALOG_PAGE_LIMIT = 100;
const MAX_PAGES_SAFETY = 50; // Hard cap against runaway loops on broken pagination contract

type SlugName = { slug: string; name: string };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (isNoIndexMode()) return [];

  const now = new Date();
  const urls: MetadataRoute.Sitemap = [
    {
      url: toAbsoluteUrl('/'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
  ];

  // Tier 2 + 3 — metadata constants (cities × categories). Failures here are
  // unlikely (backend constants, no DB hit), but we still defend.
  let cities: SlugName[] = [];
  let categories: SlugName[] = [];
  try {
    const meta = await getMetadata();
    cities = meta.cities;
    categories = meta.categories;
  } catch {
    // No metadata reachable → only home. Better than 500.
    return urls;
  }

  for (const city of cities) {
    urls.push({
      url: toAbsoluteUrl(`/${city.slug}`),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    });
    for (const cat of categories) {
      urls.push({
        url: toAbsoluteUrl(`/${city.slug}/${cat.slug}`),
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  // Tier 4 — paginated establishment slugs. Defensive: on mid-pagination
  // failure preserve any tier-4 URLs already accumulated and return early.
  // Graceful degradation — partial enumeration is strictly better than empty
  // for crawlers; the `urls` array keeps tier 1+2+3 plus whatever tier-4
  // entries were pushed before the throw.
  try {
    let page = 1;
    while (page <= MAX_PAGES_SAFETY) {
      const { establishments, pagination } = await getCatalog({
        limit: CATALOG_PAGE_LIMIT,
        page,
      });
      for (const est of establishments) {
        const citySlug = est.city_slug;
        const categorySlug = est.category_slug;
        // Skip rows the projection couldn't derive slugs for (legacy English
        // seed). Honest behavior — we don't fabricate URLs.
        if (!citySlug || !categorySlug) continue;
        urls.push({
          url: toAbsoluteUrl(`/${citySlug}/${categorySlug}/${est.slug}`),
          lastModified: est.updated_at ? new Date(est.updated_at) : now,
          changeFrequency: 'weekly',
          priority: 0.6,
        });
      }
      if (!pagination.hasNext) break;
      page++;
    }
  } catch {
    // Return tier 1+2+3 plus accumulated tier-4 entries (see comment above).
    return urls;
  }

  return urls;
}
