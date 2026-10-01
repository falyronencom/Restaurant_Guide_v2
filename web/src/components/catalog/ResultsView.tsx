import Link from 'next/link';

import { FavoritesProvider } from '@/components/favorites/FavoritesProvider';
import type { PaginationMeta, PublicEstablishmentListing } from '@/lib/api/types';
import { hasAnyFilter } from '@/lib/catalog-params';
import type { FacetOption } from '@/lib/facets';

import { CatalogPagination } from './CatalogPagination';
import { EstablishmentCard } from './EstablishmentCard';
import { FilterShelf } from './FilterShelf';
import { ResultsSwitcher } from './ResultsSwitcher';
import { SortSelect } from './SortSelect';

type Category = { slug: string; name: string };

type Props = {
  citySlug: string;
  /** Category chips — navigate by SEO path; `activeCategorySlug` highlights one. */
  categories: Category[];
  activeCategorySlug?: string;
  establishments: PublicEstablishmentListing[];
  pagination: PaginationMeta;
  /**
   * How the search phrase was understood («бургер · недорого») — shown above
   * the results so the visitor sees the phrase was read, not just matched as
   * text (the mobile preview header). null/absent → no line.
   */
  understood?: string | null;
  /** The order the search phrase asked for («недорого») — the sort select shows it. */
  sortFromPhrase?: string | null;
  /** FilterShelf / pagination base (e.g. `/minsk` or `/minsk/restaurants`). */
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  cuisineOptions: FacetOption[];
  selected: {
    cuisines: string[];
    priceRange: string[];
    features: string[];
    hours: string | undefined;
  };
  fallbackCategorySlug: string;
};

/*
 * Booking-style results layout shared by the catalog (/[city]/[category]) and
 * city (/[city]) pages — "build the layout once" (Informed Directive §3 B.1).
 *
 * Desktop: a left sticky FilterShelf rail (320px) + cards-lead column. The
 * container is FLEX, not `lg:grid-cols-[320px_1fr]` — that arbitrary-track grid
 * does NOT engage in this Tailwind v4 build (collapses to a single track;
 * validated live on /proto-results). Mobile: the shelf moves behind a "Фильтры"
 * sheet drawer. Category chips navigate by SEO path; facets live in the shelf.
 *
 * Server Component — the only interactive parts are the FilterShelf /
 * MobileFilterDrawer / Favorite islands, so the page stays ISR-friendly.
 */
export function ResultsView({
  citySlug,
  categories,
  activeCategorySlug,
  establishments,
  pagination,
  understood,
  sortFromPhrase,
  basePath,
  searchParams,
  cuisineOptions,
  selected,
  fallbackCategorySlug,
}: Props) {
  const hasResults = establishments.length > 0;
  // Zero results WITHOUT a narrowing filter means the city (or the category in
  // it) simply has no cards yet — «измените фильтры» would be a lie to a guest
  // who set none (Coordinator 01.10, А0/А2). Sorting does not narrow.
  const isNarrowed = hasAnyFilter({ ...searchParams, sort_by: undefined });
  const isEmptyPlace = pagination.total === 0 && !isNarrowed;

  return (
    <div className="lg:flex lg:items-start lg:gap-l">
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-7rem)] lg:w-80 lg:shrink-0 lg:self-start lg:overflow-y-auto">
        <FilterShelf
          citySlug={citySlug}
          categories={categories}
          activeCategorySlug={activeCategorySlug}
          basePath={basePath}
          searchParams={searchParams}
          cuisineOptions={cuisineOptions}
          selected={selected}
        />
      </aside>

      {/* min-w-0 lets the flex child shrink so the inner grid never overflows */}
      <div className="lg:min-w-0 lg:flex-1">
        <div className="mb-m flex items-center justify-between gap-m">
          <div className="min-w-0">
            <p className="text-body-m text-muted-foreground">
              {pagination.total > 0
                ? `Найдено ${pagination.total}`
                : isEmptyPlace
                  ? 'Заведений пока нет'
                  : 'Заведений по этим параметрам не найдено'}
            </p>
            {understood && (
              <p className="truncate text-body-s text-muted-foreground">
                Ищем: {understood}
              </p>
            )}
          </div>
          {pagination.total > 0 && (
            <SortSelect
              basePath={basePath}
              searchParams={searchParams}
              impliedSort={sortFromPhrase ?? undefined}
            />
          )}
        </div>

        <ResultsSwitcher
          citySlug={citySlug}
          categorySlug={activeCategorySlug}
          searchParams={searchParams}
        >
        {hasResults ? (
          <>
            <FavoritesProvider
              establishmentIds={establishments.map((e) => e.id)}
            >
              <div className="grid grid-cols-1 gap-l sm:grid-cols-2">
                {establishments.map((establishment) => (
                  <EstablishmentCard
                    key={establishment.id}
                    establishment={establishment}
                    fallbackCitySlug={citySlug}
                    fallbackCategorySlug={fallbackCategorySlug}
                  />
                ))}
              </div>
            </FavoritesProvider>

            <div className="mt-l">
              <CatalogPagination
                currentPage={pagination.page}
                totalPages={pagination.totalPages}
                basePath={basePath}
                searchParams={searchParams}
              />
            </div>
          </>
        ) : isEmptyPlace ? (
          <section className="flex flex-col items-center gap-m py-xl text-center">
            <h2 className="font-display text-headline-m">
              {activeCategorySlug
                ? 'В этой категории пока нет заведений'
                : 'В этом городе пока нет заведений'}
            </h2>
            <p className="max-w-md text-body-m text-muted-foreground">
              Мы добавляем заведения постепенно.
            </p>
            <Link
              href={activeCategorySlug ? `/${citySlug}` : '/'}
              className="text-primary underline-offset-4 hover:underline"
            >
              {activeCategorySlug ? '← Все заведения города' : '← На главную'}
            </Link>
          </section>
        ) : (
          <section className="flex flex-col items-center gap-m py-xl text-center">
            <h2 className="font-display text-headline-m">Ничего не найдено</h2>
            <p className="max-w-md text-body-m text-muted-foreground">
              Попробуйте изменить фильтры или вернуться ко всем заведениям
              города.
            </p>
            <Link
              href={`/${citySlug}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              ← Все заведения города
            </Link>
          </section>
        )}
        </ResultsSwitcher>
      </div>
    </div>
  );
}
