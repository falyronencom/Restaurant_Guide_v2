import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getCatalog } from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { CatalogPagination } from '@/components/catalog/CatalogPagination';
import { EstablishmentCard } from '@/components/catalog/EstablishmentCard';

/*
 * /[city]/[category] — canonical catalog page (Brief 3).
 *
 * Server Component. Validates both slugs against /metadata, fetches the
 * catalog in parallel with metadata (React.cache deduplicates the metadata
 * call across this file's three consumers: generateMetadata + page render
 * + validate{City,Category}Slug).
 *
 * Filter query-string handling: reads cuisine / priceRange / minRating /
 * search / sort_by / page from `searchParams`, passes through to backend.
 * Filtered URLs get noindex robots meta + canonical to the clean variant
 * (CAT-C-2.3 — prevent indexing of every filter permutation while still
 * allowing crawlers to follow links).
 *
 * Pagination: ISR-friendly (revalidate=3600). Each page-N variant caches
 * separately under the same TTL. EmptyState rendered when zero matches.
 */
export const revalidate = 3600;

type Params = { city: string; category: string };
type SearchParams = { [key: string]: string | string[] | undefined };

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

  return {
    title: `${capitalize(lowerCat)} в городе ${cityName}`,
    description: `Каталог: ${lowerCat} в городе ${cityName}. Рейтинги, актуальные акции, контакты.`,
    robots: hasFilters ? { index: false, follow: true } : undefined,
    alternates: hasFilters
      ? { canonical: `/${city}/${category}` }
      : undefined,
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

  // Parse filter / pagination params from query-string
  const page = parsePage(sp.page);
  const sortBy = asString(sp.sort_by);
  const search = asString(sp.search);
  const cuisine = asString(sp.cuisine);
  const priceRange = asString(sp.priceRange);
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
      cuisines: cuisine ? [cuisine] : undefined,
      priceRange: priceRange ? [priceRange] : undefined,
      minRating,
      search,
    }),
  ]);

  const cityName =
    meta.cities.find((c) => c.slug === city)?.name ?? city;
  const categoryName =
    meta.categories.find((c) => c.slug === category)?.name ?? category;

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
        <p className='text-body-m text-muted-foreground'>
          {catalog.pagination.total > 0
            ? `Найдено заведений: ${catalog.pagination.total}`
            : 'Заведений по этим параметрам не найдено'}
        </p>
      </header>

      {catalog.establishments.length === 0 ? (
        <section className='flex flex-1 flex-col items-center justify-center gap-m py-xl text-center'>
          <h2 className='text-headline-m font-display'>Ничего не найдено</h2>
          <p className='max-w-md text-body-m text-muted-foreground'>
            Попробуйте изменить параметры поиска или вернитесь к каталогу
            города.
          </p>
          <Link
            href={`/${city}`}
            className='text-primary underline-offset-4 hover:underline'
          >
            ← Все категории города {cityName}
          </Link>
        </section>
      ) : (
        <section className='grid grid-cols-1 gap-l sm:grid-cols-2 lg:grid-cols-3'>
          {catalog.establishments.map((establishment) => (
            <EstablishmentCard
              key={establishment.id}
              establishment={establishment}
              fallbackCitySlug={city}
              fallbackCategorySlug={category}
            />
          ))}
        </section>
      )}

      <CatalogPagination
        currentPage={catalog.pagination.page}
        totalPages={catalog.pagination.totalPages}
        basePath={`/${city}/${category}`}
        searchParams={sp}
      />
    </main>
  );
}

// ----- helpers -------------------------------------------------------------

function parsePage(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return n;
}

function asString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function asFloat(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function hasAnyFilter(sp: SearchParams): boolean {
  // Reuse asString to drop empty-string params and ignore array-form params
  // (catalog URL contract is single-value-per-key; array forms aren't yet
  // supported and shouldn't trip noindex). Symmetric with how the page body
  // parses filters into getCatalog args.
  return Boolean(
    asString(sp.cuisine) ||
      asString(sp.priceRange) ||
      asString(sp.minRating) ||
      asString(sp.search) ||
      asString(sp.sort_by),
  );
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0].toLocaleUpperCase('ru-RU') + s.slice(1);
}
