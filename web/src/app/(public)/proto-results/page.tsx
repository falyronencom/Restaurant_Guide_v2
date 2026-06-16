import Link from 'next/link';

import { getMetadata } from '@/lib/api/endpoints/metadata';
import { getCatalog } from '@/lib/api/endpoints/establishments';
import { FilterShelf } from '@/components/catalog/FilterShelf';
import { EstablishmentCard } from '@/components/catalog/EstablishmentCard';
import { FavoritesProvider } from '@/components/favorites/FavoritesProvider';
import { CategoryIcon } from '@/components/catalog/CategoryIcon';
import { HOURS_VALUES } from '@/lib/facets';

/*
 * /proto-results — DISPOSABLE visual target for Segment B (Booking results).
 * NOT prod. Inherits the real Segment A shell (under (public)) and reuses real
 * bricks: <CategoryIcon> chips, FilterShelf, EstablishmentCard, getCatalog.
 *
 * Layout per Segment A §7 continuation note: `lg:grid-cols-[320px_1fr]`,
 * FilterShelf in a left sticky <aside>, cards LEAD; category chips on top;
 * getCatalog({city}) with NO category. Mobile: filters behind a button (Segment B
 * ships ui/sheet.tsx). Shows 6 cards for a light, screenshot-friendly page.
 * Delete after use.
 */

const CITY_SLUG = 'minsk';
type SearchParams = { [k: string]: string | string[] | undefined };

export const revalidate = 3600;

export default async function ProtoResultsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const cuisines = asList(sp.cuisine);
  const priceRange = asList(sp.priceRange);
  const hours = asHours(sp.hours);

  const [meta, catalog] = await Promise.all([
    getMetadata(),
    getCatalog({
      city: CITY_SLUG,
      cuisines: cuisines.length ? cuisines : undefined,
      priceRange: priceRange.length ? priceRange : undefined,
      hours_filter: hours,
    }),
  ]);
  const cuisineOptions = meta.cuisines.map((c) => ({
    value: c.slug,
    label: c.name,
  }));
  const shown = catalog.establishments.slice(0, 6);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-m p-l">
      <header className="flex flex-col gap-xs">
        <p className="text-caption-l text-muted-foreground">Минск</p>
        <h1 className="font-display text-[30px] leading-tight md:text-[40px]">
          Заведения в Минске
        </h1>
      </header>

      {/* Category chips — real <CategoryIcon> (Segment A brick) */}
      <nav aria-label="Категории" className="flex flex-wrap gap-s">
        {meta.categories.map((cat) => (
          <Link
            key={cat.slug}
            href={`/${CITY_SLUG}/${cat.slug}`}
            className="flex items-center gap-s rounded-full border border-border bg-figma-bg-warm px-m py-s text-label-m text-foreground transition-colors hover:border-brand hover:text-brand-dark"
          >
            <CategoryIcon slug={cat.slug} size={20} />
            {cat.name}
          </Link>
        ))}
      </nav>

      {/* Booking layout — sidebar (320px) + cards-forward.
          NOTE: `lg:grid-cols-[320px_1fr]` (as Segment A §7 prescribes) does NOT
          engage in this Tailwind v4 setup — it computes to a single 1104px column.
          Validated approach is flex: `lg:flex` + `lg:w-80` aside + `lg:flex-1` cards. */}
      <div className="lg:flex lg:items-start lg:gap-l">
        {/* Mobile: filters behind a button (Segment B → ui/sheet.tsx) */}
        <div className="mb-s lg:hidden">
          <span className="inline-flex items-center gap-s rounded-full border border-border bg-background px-l py-m text-label-l text-foreground shadow-sm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
              <circle cx="15" cy="7" r="2" />
              <circle cx="9" cy="17" r="2" />
            </svg>
            Фильтры
          </span>
        </div>

        {/* Desktop: left sidebar (sticky) */}
        <aside className="hidden lg:sticky lg:top-4 lg:block lg:w-80 lg:shrink-0 lg:self-start">
          <FilterShelf
            basePath="/proto-results"
            searchParams={sp}
            cuisineOptions={cuisineOptions}
            selected={{ cuisines, priceRange, hours }}
          />
        </aside>

        {/* Cards — lead */}
        <div className="lg:flex-1">
          <p className="mb-m text-body-m text-muted-foreground">
            Найдено заведений: {catalog.pagination.total}
          </p>
          {shown.length > 0 && (
            <FavoritesProvider establishmentIds={shown.map((e) => e.id)}>
              <div className="grid grid-cols-1 gap-l sm:grid-cols-2">
                {shown.map((establishment) => (
                  <EstablishmentCard
                    key={establishment.id}
                    establishment={establishment}
                    fallbackCitySlug={CITY_SLUG}
                    fallbackCategorySlug="restaurants"
                  />
                ))}
              </div>
            </FavoritesProvider>
          )}
        </div>
      </div>
    </main>
  );
}

// ----- helpers (mirrored from the catalog page) ----------------------------

type HoursBucket = 'until_22' | 'until_morning' | '24_hours';

function asList(raw: unknown): string[] {
  if (typeof raw === 'string')
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw))
    return raw
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function asHours(raw: unknown): HoursBucket | undefined {
  return typeof raw === 'string' && HOURS_VALUES.includes(raw)
    ? (raw as HoursBucket)
    : undefined;
}
