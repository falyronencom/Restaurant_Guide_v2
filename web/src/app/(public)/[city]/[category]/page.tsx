import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getCatalog } from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { ResultsView } from '@/components/catalog/ResultsView';
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
 * /[city]/[category] — canonical catalog page (Brief 3).
 *
 * Server Component. Validates both slugs against /metadata, fetches the
 * catalog in parallel with metadata (React.cache deduplicates the metadata
 * call across this file's three consumers: generateMetadata + page render
 * + validate{City,Category}Slug).
 *
 * Filter query-string handling: reads cuisine / priceRange (multi-value,
 * comma-joined) / hours (single bucket) / minRating / search / sort_by / page
 * from `searchParams`, passes through to backend. The interactive shelf
 * (FilterShelf, a 'use client' island) only mutates the URL — the server
 * re-fetch applies the filtering. Filtered URLs get noindex robots meta +
 * canonical to the clean variant (CAT-C-2.3 — prevent indexing of every filter
 * permutation while still allowing crawlers to follow links).
 *
 * Pagination: ISR-friendly (revalidate=3600). Each page-N variant caches
 * separately under the same TTL. EmptyState rendered when zero matches.
 */
export const revalidate = 3600;

type Params = { city: string; category: string };

export async function generateStaticParams(): Promise<Params[]> {
  // Defer to runtime — city × category combinatorial explosion. Brief 3
  // does not pre-warm. Future optimization may pre-render popular pairs.
  return [];
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { city, category } = await params;
  const sp = await searchParams;

  let cityName = city;
  let categoryName = category;
  try {
    const meta = await getMetadata();
    cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
    categoryName =
      meta.categories.find((c) => c.slug === category)?.name ?? category;
  } catch {
    // Metadata fetch failed during metadata generation — fall back to slug
    // strings. The page itself runs validateCitySlug/validateCategorySlug
    // and will 404 cleanly if slugs are bogus.
  }

  const hasFilters = hasAnyFilter(sp);
  const lowerCat = categoryName.toLowerCase();
  const title = `${capitalize(lowerCat)} в городе ${cityName}`;
  const description = `Каталог: ${lowerCat} в городе ${cityName}. Рейтинги, актуальные акции, контакты.`;

  return {
    title,
    description,
    // CAT-C-2.3 filter-aware noindex preserved. Canonical is now always set
    // (not just on filter URLs) — for filter permutations it consolidates
    // the noindex'd variant onto the clean URL (CAT-C-2.3 core); for the
    // clean URL itself it explicitly anchors the canonical signal.
    // metadataBase in root layout auto-promotes the relative path → absolute.
    robots: hasFilters ? { index: false, follow: true } : undefined,
    alternates: {
      canonical: `/${city}/${category}`,
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

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { city, category } = await params;
  const sp = await searchParams;

  // Validate both slugs in parallel — single /metadata fetch shared via
  // React.cache wrapper on getMetadata.
  const [cityValid, categoryValid] = await Promise.all([
    validateCitySlug(city),
    validateCategorySlug(category),
  ]);
  if (!cityValid || !categoryValid) notFound();

  // Parse filter / pagination params from query-string. cuisine & priceRange
  // are multi-value (comma-joined, OR-within-group); hours is a single bucket.
  const page = parsePage(sp.page);
  const sortBy = asString(sp.sort_by);
  const search = asString(sp.search);
  const cuisines = asList(sp.cuisine);
  const priceRange = asList(sp.priceRange);
  const features = asList(sp.features);
  const hours = asHours(sp.hours);
  const minRating = asFloat(sp.minRating);

  // Parallel fetches — metadata is cached after validate calls above, so
  // this resolves immediately; catalog actually hits backend.
  const [meta, catalog] = await Promise.all([
    getMetadata(),
    getCatalog({
      city,
      category,
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

  const cityName =
    meta.cities.find((c) => c.slug === city)?.name ?? city;
  const categoryName =
    meta.categories.find((c) => c.slug === category)?.name ?? category;
  const cuisineOptions = meta.cuisines.map((c) => ({
    value: c.slug,
    label: c.name,
  }));

  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-l p-l'>
      <header className='flex flex-col gap-s'>
        <nav
          aria-label='Хлебные крошки'
          className='flex items-center gap-s text-caption-l text-muted-foreground'
        >
          <Link href='/' className='hover:text-foreground'>
            Главная
          </Link>
          <span aria-hidden='true'>/</span>
          <Link href={`/${city}`} className='hover:text-foreground'>
            {cityName}
          </Link>
          <span aria-hidden='true'>/</span>
          <span aria-current='page'>{categoryName.toLowerCase()}</span>
        </nav>
        <h1 className='text-display-s font-display'>
          {categoryName} в городе {cityName}
        </h1>
      </header>

      <ResultsView
        citySlug={city}
        categories={meta.categories}
        activeCategorySlug={category}
        establishments={catalog.establishments}
        pagination={catalog.pagination}
        basePath={`/${city}/${category}`}
        searchParams={sp}
        cuisineOptions={cuisineOptions}
        selected={{ cuisines, priceRange, features, hours }}
        fallbackCategorySlug={category}
      />
    </main>
  );
}

// ----- helpers -------------------------------------------------------------

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0].toLocaleUpperCase('ru-RU') + s.slice(1);
}
