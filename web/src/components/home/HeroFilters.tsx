'use client';

import { CategoryIcon } from '@/components/catalog/CategoryIcon';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { MetadataSlug } from '@/lib/api/types';
import { HOURS_OPTIONS, PRICE_OPTIONS } from '@/lib/facets';
import { cn } from '@/lib/utils';

export type HeroFilterValue = {
  cuisines: string[];
  priceRange: string[];
  hours: string | undefined;
};

type Props = {
  cuisines: MetadataSlug[];
  value: HeroFilterValue;
  onChange: (next: HeroFilterValue) => void;
};

/*
 * Hero filter panel — the «Фильтры» pill opens a sheet of the three facets the
 * results page actually understands: cuisine (multi), price (multi), hours
 * (single). It does NOT navigate: selections live in HeroSearch state and are
 * appended to the URL only when the orange Search runs (city is context, filters
 * are refinement — mirrors mobile/Booking, where only «Найти» loads results).
 *
 * Distance and attributes (the other mobile-filter sections) are out of web v1
 * scope — deferred to later phases (no client geo / no attribute facet on the
 * catalog path). Category is a SEO route segment, picked via chips on the
 * results page, not a query facet.
 *
 * Controlled: value + onChange come from HeroSearch; the sheet's own open state
 * stays uncontrolled (base-ui Dialog).
 */
export function HeroFilters({ cuisines, value, onChange }: Props) {
  const activeCount =
    value.cuisines.length + value.priceRange.length + (value.hours ? 1 : 0);

  const toggleCuisine = (slug: string) =>
    onChange({
      ...value,
      cuisines: value.cuisines.includes(slug)
        ? value.cuisines.filter((s) => s !== slug)
        : [...value.cuisines, slug],
    });
  const togglePrice = (p: string) =>
    onChange({
      ...value,
      priceRange: value.priceRange.includes(p)
        ? value.priceRange.filter((v) => v !== p)
        : [...value.priceRange, p],
    });
  const toggleHours = (h: string) =>
    onChange({ ...value, hours: value.hours === h ? undefined : h });
  const reset = () =>
    onChange({ cuisines: [], priceRange: [], hours: undefined });

  return (
    <Sheet>
      <SheetTrigger className="flex items-center gap-s rounded-full border border-white/70 px-l py-s text-label-l text-white transition-colors hover:bg-white/10">
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
        {activeCount > 0 && (
          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-label-s text-white">
            {activeCount}
          </span>
        )}
      </SheetTrigger>

      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto p-l sm:max-w-md"
      >
        <SheetHeader className="flex-row items-center justify-between p-0 pb-l">
          <SheetTitle>Фильтры</SheetTitle>
          <button
            type="button"
            onClick={reset}
            disabled={activeCount === 0}
            className="text-body-m text-brand transition-colors hover:text-brand-dark disabled:text-text-tertiary"
          >
            Сбросить
          </button>
        </SheetHeader>

        <section className="pb-l">
          <h3 className="mb-m text-label-l text-foreground">Категория кухни</h3>
          <div className="grid grid-cols-3 gap-s">
            {cuisines.map((c) => {
              const active = value.cuisines.includes(c.slug);
              return (
                <button
                  key={c.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleCuisine(c.slug)}
                  className={cn(
                    'flex flex-col items-center gap-s rounded-2xl border p-m text-center text-caption-m transition-colors',
                    active
                      ? 'border-brand bg-brand/10 text-foreground'
                      : 'border-border bg-background text-text-secondary hover:bg-muted',
                  )}
                >
                  <CategoryIcon slug={c.slug} size={28} />
                  {c.name}
                </button>
              );
            })}
          </div>
        </section>

        <section className="border-t border-border py-l">
          <h3 className="mb-m text-label-l text-foreground">Средний чек</h3>
          <div className="grid grid-cols-3 gap-s">
            {PRICE_OPTIONS.map((opt) => {
              const active = value.priceRange.includes(opt.value);
              const [symbol, sub] = opt.label.split(' · ');
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => togglePrice(opt.value)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-2xl border p-m transition-colors',
                    active
                      ? 'border-brand bg-brand/10'
                      : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  <span className="text-headline-m font-bold text-brand">
                    {symbol}
                  </span>
                  <span className="text-caption-m text-text-secondary">
                    {sub}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="border-t border-border py-l">
          <h3 className="mb-m text-label-l text-foreground">Время работы</h3>
          <div className="flex flex-wrap gap-s">
            {HOURS_OPTIONS.map((opt) => {
              const active = value.hours === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleHours(opt.value)}
                  className={cn(
                    'rounded-full border px-l py-s text-body-m transition-colors',
                    active
                      ? 'border-brand bg-brand text-white'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </section>

        <SheetClose className="mt-m w-full rounded-full bg-brand px-l py-m text-label-l text-white transition-colors hover:bg-brand-dark">
          Готово
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
