import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCatalog } from '@/lib/api/endpoints/establishments';
import { getMetadata, validateCitySlug } from '@/lib/api/endpoints/metadata';
import { CatalogHero } from '@/components/catalog/CatalogHero';
import { ResultsView } from '@/components/catalog/ResultsView';
import { cityHeading } from '@/lib/catalog-labels';
import {
  asFloat,
  asHours,
  asList,
  asString,
  hasAnyFilter,
  parsePage,
  type SearchParams,
} from '@/lib/catalog-params';

/*
 * /[city] — city-wide results view (web-vitrine Segment B).
 *
 * Replaces the Brief-2 placeholder. Lists all active establishments of the city
 * via getCatalog({ city }) (no category) in the shared Booking layout
 * (ResultsView): category chips → SEO paths, facet sidebar, cards-lead. Same
 * filter query-string contract + CAT-C-2.3 noindex-on-filter posture as the
 * catalog page (first web caller of the category-less getCatalog path).
 *
 * Greedy [city] note: any top-level path (/about, ...) matches [city] first;
 * validateCitySlug → notFound() protects it. Declare real top-level segments
 * BEFORE introducing them.
 */
// Reads searchParams (facets) → must render per-request. Next 16 cannot
// statically generate a searchParams-reading page (ISR keys by pathname, not
// query → DYNAMIC_SERVER_USAGE 500 in prod `next start`; `next dev` masks it).
// Per-request SSR keeps the results list in HTML — SEO-critical for this primary
// indexed surface. Real caching returns later via CDN keyed by the FULL URL incl.
// query (CAT-C-4.3) — the exact pathname-only limit that made ISR incoherent
// here. The prior `revalidate` + `generateStaticParams ⇒ []` were misleading
// (the route was never actually statically cached). (Trunk decision 2026-06-19.)
export const dynamic = 'force-dynamic';

type Params = { city: string };

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { city } = await params;
  const sp = await searchParams;

  let cityName = city;
  try {
    const meta = await getMetadata();
    cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
  } catch {
    // Metadata fetch failed — fall back to slug. validateCitySlug in the body
    // 404s a bogus slug cleanly.
  }

  const title = cityHeading(city, cityName);
  const description = `Каталог ресторанов, кафе и баров — ${cityName}. Рейтинги, акции, контакты.`;

  return {
    title,
    description,
    // CAT-C-2.3: now that the city page carries facets, filtered permutations
    // (?cuisine=…&priceRange=…) get noindex + canonical onto the clean city URL;
    // the clean URL itself stays indexable (mirrors /[city]/[category]).
    robots: hasAnyFilter(sp) ? { index: false, follow: true } : undefined,
    alternates: {
      canonical: `/${city}`,
    },
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function CityPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { city } = await params;
  const sp = await searchParams;

  const isValid = await validateCitySlug(city);
  if (!isValid) notFound();

  // Parse filter / pagination params — identical contract to the catalog page.
  const page = parsePage(sp.page);
  const sortBy = asString(sp.sort_by);
  const search = asString(sp.search);
  const cuisines = asList(sp.cuisine);
  const priceRange = asList(sp.priceRange);
  const features = asList(sp.features);
  const hours = asHours(sp.hours);
  const minRating = asFloat(sp.minRating);

  const [meta, catalog] = await Promise.all([
    getMetadata(),
    getCatalog({
      city,
      page,
      sort_by: sortBy,
      cuisines: cuisines.length > 0 ? cuisines : undefined,
      priceRange: priceRange.length > 0 ? priceRange : undefined,
      features: features.length > 0 ? features : undefined,
      hours_filter: hours,
      minRating,
      search,
    }),
  ]);

  const cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
  const cuisineOptions = meta.cuisines.map((c) => ({
    value: c.slug,
    label: c.name,
  }));

  return (
    <>
      <CatalogHero
        citySlug={city}
        cityName={cityName}
        cities={meta.cities}
        searchParams={sp}
      />

      <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-l p-l'>
        <ResultsView
          citySlug={city}
          categories={meta.categories}
          establishments={catalog.establishments}
          pagination={catalog.pagination}
          basePath={`/${city}`}
          searchParams={sp}
          cuisineOptions={cuisineOptions}
          selected={{ cuisines, priceRange, features, hours }}
          fallbackCategorySlug='restaurants'
        />
      </main>
    </>
  );
}
