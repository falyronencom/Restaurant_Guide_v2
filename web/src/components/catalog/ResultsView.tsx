import Link from 'next/link';

import { FavoritesProvider } from '@/components/favorites/FavoritesProvider';
import type { PaginationMeta, PublicEstablishmentListing } from '@/lib/api/types';
import type { FacetOption } from '@/lib/facets';
import { cn } from '@/lib/utils';

import { CatalogPagination } from './CatalogPagination';
import { CategoryIcon } from './CategoryIcon';
import { EstablishmentCard } from './EstablishmentCard';
import { FilterShelf } from './FilterShelf';
import { MobileFilterDrawer } from './MobileFilterDrawer';

type Category = { slug: string; name: string };

type Props = {
  citySlug: string;
  /** Category chips — navigate by SEO path; `activeCategorySlug` highlights one. */
  categories: Category[];
  activeCategorySlug?: string;
  establishments: PublicEstablishmentListing[];
  pagination: PaginationMeta;
  /** FilterShelf / pagination base (e.g. `/minsk` or `/minsk/restaurants`). */
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  cuisineOptions: FacetOption[];
  selected: { cuisines: string[]; priceRange: string[]; hours: string | undefined };
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
  basePath,
  searchParams,
  cuisineOptions,
  selected,
  fallbackCategorySlug,
}: Props) {
  const hasResults = establishments.length > 0;

  return (
    <div className="flex flex-col gap-l">
      <nav aria-label="Категории" className="flex flex-wrap gap-s">
        {categories.map((cat) => {
          const active = cat.slug === activeCategorySlug;
          return (
            <Link
              key={cat.slug}
              href={`/${citySlug}/${cat.slug}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-s rounded-full border px-m py-s text-label-m transition-colors',
                active
                  ? 'border-brand bg-brand text-text-on-primary'
                  : 'border-border bg-figma-bg-warm text-foreground hover:border-brand hover:text-brand-dark',
              )}
            >
              <CategoryIcon slug={cat.slug} size={20} />
              {cat.name}
            </Link>
          );
        })}
      </nav>

      <div className="lg:flex lg:items-start lg:gap-l">
        <MobileFilterDrawer
          basePath={basePath}
          searchParams={searchParams}
          cuisineOptions={cuisineOptions}
          selected={selected}
        />

        <aside className="hidden lg:sticky lg:top-4 lg:block lg:w-80 lg:shrink-0 lg:self-start">
          <FilterShelf
            basePath={basePath}
            searchParams={searchParams}
            cuisineOptions={cuisineOptions}
            selected={selected}
          />
        </aside>

        {/* min-w-0 lets the flex child shrink so the inner grid never overflows */}
        <div className="lg:min-w-0 lg:flex-1">
          <p className="mb-m text-body-m text-muted-foreground">
            {pagination.total > 0
              ? `Найдено заведений: ${pagination.total}`
              : 'Заведений по этим параметрам не найдено'}
          </p>

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
        </div>
      </div>
    </div>
  );
}
