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
import { ATTRIBUTE_OPTIONS, HOURS_OPTIONS, PRICE_OPTIONS } from '@/lib/facets';
import { cn } from '@/lib/utils';

export type HeroFilterValue = {
  cuisines: string[];
  priceRange: string[];
  features: string[];
  hours: string | undefined;
};

type Props = {
  categories: MetadataSlug[];
  cuisines: MetadataSlug[];
  value: HeroFilterValue;
  onChange: (next: HeroFilterValue) => void;
  selectedCategory: string | null;
  onCategoryChange: (slug: string | null) => void;
};

/*
 * Hero filter panel — the «Фильтры» pill opens a sheet of:
 *   • establishment category (single-select → becomes the SEO path segment on
 *     submit; the other facets are query params),
 *   • cuisine (multi), price (multi), working-hours (single), and
 *   • attributes / «Дополнительно» (multi).
 *
 * It does NOT navigate: selections live in HeroSearch state and are applied to
 * the URL only when the orange Search runs (city is context, the panel is
 * refinement — mirrors mobile/Booking, where only «Найти» loads results).
 *
 * Category is single-select because on the web a category is a route segment
 * (/[city]/[category]) — one per route. Attributes use the REAL data-canon keys
 * (lib/facets ATTRIBUTE_OPTIONS) and are AND-ed by the backend, so — unlike
 * cuisine/price — selecting "all" is meaningful and is NOT collapsed away.
 *
 * Controlled: value/onChange + selectedCategory/onCategoryChange come from
 * HeroSearch; the sheet's own open state stays uncontrolled (base-ui Dialog).
 */
export function HeroFilters({
  categories,
  cuisines,
  value,
  onChange,
  selectedCategory,
  onCategoryChange,
}: Props) {
  const activeCount =
    value.cuisines.length +
    value.priceRange.length +
    value.features.length +
    (value.hours ? 1 : 0) +
    (selectedCategory ? 1 : 0);

  const toggleCategory = (slug: string) =>
    onCategoryChange(selectedCategory === slug ? null : slug);
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
  const toggleFeature = (f: string) =>
    onChange({
      ...value,
      features: value.features.includes(f)
        ? value.features.filter((v) => v !== f)
        : [...value.features, f],
    });
  const toggleHours = (h: string) =>
    onChange({ ...value, hours: value.hours === h ? undefined : h });
  const reset = () => {
    onChange({ cuisines: [], priceRange: [], features: [], hours: undefined });
    onCategoryChange(null);
  };

  return (
    <Sheet>
      <SheetTrigger className="flex items-center gap-s rounded-2xl border border-white/70 px-l py-s text-label-l text-white transition-colors hover:bg-white/10">
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
        // Full-screen on phones (override the sheet's `data-[side=right]:w-3/4`
        // at the same variant); `sm:max-w-sm` still caps it on tablet/desktop.
        className="gap-0 overflow-y-auto p-l data-[side=right]:w-full"
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
          <h3 className="mb-m text-label-l text-foreground">
            Категория заведения
          </h3>
          <div className="grid grid-cols-3 gap-s">
            {categories.map((c) => {
              const active = selectedCategory === c.slug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleCategory(c.slug)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-m border px-1 py-3 text-center text-[11px] leading-tight break-words transition-colors',
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
                    'flex flex-col items-center gap-1.5 rounded-m border px-1 py-3 text-center text-[11px] leading-tight break-words transition-colors',
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
              const sub = opt.label.split(' · ')[1] ?? opt.label;
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
                    {'$'.repeat(opt.value.length)}
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

        <section className="border-t border-border py-l">
          <h3 className="mb-m text-label-l text-foreground">Дополнительно</h3>
          <div className="flex flex-wrap gap-s">
            {ATTRIBUTE_OPTIONS.map((opt) => {
              const active = value.features.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleFeature(opt.value)}
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
