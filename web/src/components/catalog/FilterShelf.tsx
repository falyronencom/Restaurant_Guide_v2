'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import type { ReactNode } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type { MetadataSlug } from '@/lib/api/types';
import {
  ATTRIBUTE_OPTIONS,
  ATTRIBUTE_VALUES,
  HOURS_OPTIONS,
  PRICE_OPTIONS,
  PRICE_VALUES,
  type FacetOption,
} from '@/lib/facets';
import { cn } from '@/lib/utils';

import { CategoryIcon } from './CategoryIcon';

/*
 * FilterShelf — searchParams-driven facet shelf for the catalog page (and the
 * shared city page via ResultsView). Tile/pill UI mirrors the home HeroFilters
 * panel; the design moved the category selector into this shelf.
 *
 * Client island (the only interactive part of the otherwise-Server catalog
 * page). It does NO client-side filtering: every facet toggle mutates the URL
 * query-string and the Server Component re-fetches (mirrors mobile — collect
 * selection → params → backend applies OR/AND).
 *
 * Category is single-select AND rendered as <Link>s, not buttons: a category is
 * the SEO route segment /{city}/{category}, so the cross-category links stay
 * crawlable <a> tags pointing at the clean (facet-free) category URL. The other
 * facets — cuisine (multi), price (multi), working-hours (single), attributes
 * (multi) — are buttons that mutate the query (those URLs are noindex anyway).
 *
 * URL contract mirrors CatalogPagination.buildHref: preserve sibling params,
 * reset `page` on every facet change, multi-value facets stay comma-joined.
 */

type Selected = {
  cuisines: string[];
  priceRange: string[];
  features: string[];
  hours: string | undefined;
};

type Props = {
  citySlug: string;
  categories: MetadataSlug[];
  activeCategorySlug?: string;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  cuisineOptions: readonly FacetOption[];
  selected: Selected;
};

// Tile + pill style tokens (mirror of the home HeroFilters panel).
const TILE_BASE =
  'flex flex-col items-center gap-1.5 rounded-m border px-1 py-3 text-center transition-colors';
const PRICE_TILE_BASE =
  'flex flex-col items-center gap-0.5 rounded-m border px-1 py-2.5 transition-colors';
const TILE_ACTIVE = 'border-brand bg-brand/10';
const TILE_INACTIVE = 'border-border bg-background hover:bg-muted';
const TILE_LABEL = 'text-[11px] leading-tight text-foreground';

const PILL_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-[7px] text-[13px] transition-colors';
const PILL_ACTIVE = 'border-brand bg-brand text-white';
const PILL_INACTIVE = 'border-border bg-background text-foreground hover:bg-muted';

export function FilterShelf({
  citySlug,
  categories,
  activeCategorySlug,
  basePath,
  searchParams,
  cuisineOptions,
  selected,
}: Props) {
  const router = useRouter();

  // Clone current params, replace `key` with `value` (or drop it when value is
  // undefined), ALWAYS drop `page` (a filter change returns to page 1), navigate.
  const navigate = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(searchParams)) {
        if (k === 'page' || k === key) continue;
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (const item of v) params.append(k, item);
        } else {
          params.set(k, v);
        }
      }
      if (value) params.set(key, value);
      const qs = params.toString();
      router.push(qs ? `${basePath}?${qs}` : basePath);
    },
    [router, basePath, searchParams],
  );

  // Multi-select (OR-within-group): add/remove a value in a comma-joined param.
  // For OR-within facets (cuisine/price) "all selected" == "no constraint" → omit
  // the param. For AND-between facets (features) "all" is a real filter → keep it,
  // omit only when empty (omitWhenAll=false).
  const toggleMulti = useCallback(
    (
      key: string,
      current: string[],
      value: string,
      allValues: readonly string[],
      omitWhenAll = true,
    ) => {
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const omit =
        next.length === 0 || (omitWhenAll && next.length === allValues.length);
      navigate(key, omit ? undefined : next.join(','));
    },
    [navigate],
  );

  // Single-select: re-selecting the active bucket clears it (mirrors mobile).
  const toggleSingle = useCallback(
    (key: string, current: string | undefined, value: string) => {
      navigate(key, current === value ? undefined : value);
    },
    [navigate],
  );

  const cuisineValues = cuisineOptions.map((o) => o.value);

  return (
    <Accordion
      defaultValue={['category', 'cuisine', 'price', 'hours', 'features']}
      className='rounded-l border border-border bg-background px-m'
      aria-label='Фильтры'
    >
      <FacetGroup id='category' title='Категория'>
        <div className='grid grid-cols-3 gap-s'>
          {categories.map((cat) => {
            const active = cat.slug === activeCategorySlug;
            return (
              <Link
                key={cat.slug}
                href={`/${citySlug}/${cat.slug}`}
                aria-current={active ? 'page' : undefined}
                className={cn(TILE_BASE, active ? TILE_ACTIVE : TILE_INACTIVE)}
              >
                <CategoryIcon slug={cat.slug} size={28} />
                <span className={TILE_LABEL}>{cat.name}</span>
              </Link>
            );
          })}
        </div>
      </FacetGroup>

      <FacetGroup id='cuisine' title='Кухня'>
        <div className='grid grid-cols-3 gap-s'>
          {cuisineOptions.map((opt) => {
            const active = selected.cuisines.includes(opt.value);
            return (
              <button
                key={opt.value}
                type='button'
                aria-pressed={active}
                onClick={() =>
                  toggleMulti('cuisine', selected.cuisines, opt.value, cuisineValues)
                }
                className={cn(TILE_BASE, active ? TILE_ACTIVE : TILE_INACTIVE)}
              >
                <CategoryIcon slug={opt.value} size={28} />
                <span className={TILE_LABEL}>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </FacetGroup>

      <FacetGroup id='price' title='Средний чек'>
        <div className='grid grid-cols-3 gap-s'>
          {PRICE_OPTIONS.map((opt) => {
            const active = selected.priceRange.includes(opt.value);
            const sub = opt.label.split(' · ')[1] ?? opt.label;
            return (
              <button
                key={opt.value}
                type='button'
                aria-pressed={active}
                onClick={() =>
                  toggleMulti(
                    'priceRange',
                    selected.priceRange,
                    opt.value,
                    PRICE_VALUES,
                  )
                }
                className={cn(
                  PRICE_TILE_BASE,
                  active ? TILE_ACTIVE : TILE_INACTIVE,
                )}
              >
                <span className='text-[15px] leading-none font-bold text-brand'>
                  {'₽'.repeat(opt.value.length)}
                </span>
                <span className='text-[10px] text-text-secondary'>{sub}</span>
              </button>
            );
          })}
        </div>
      </FacetGroup>

      <FacetGroup id='hours' title='Время работы'>
        <div className='flex flex-wrap gap-s'>
          {HOURS_OPTIONS.map((opt) => {
            const active = selected.hours === opt.value;
            return (
              <button
                key={opt.value}
                type='button'
                aria-pressed={active}
                onClick={() => toggleSingle('hours', selected.hours, opt.value)}
                className={cn(PILL_BASE, active ? PILL_ACTIVE : PILL_INACTIVE)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </FacetGroup>

      <FacetGroup id='features' title='Дополнительно'>
        <div className='flex flex-wrap gap-s'>
          {ATTRIBUTE_OPTIONS.map((opt) => {
            const active = selected.features.includes(opt.value);
            return (
              <button
                key={opt.value}
                type='button'
                aria-pressed={active}
                onClick={() =>
                  toggleMulti(
                    'features',
                    selected.features,
                    opt.value,
                    ATTRIBUTE_VALUES,
                    false,
                  )
                }
                className={cn(PILL_BASE, active ? PILL_ACTIVE : PILL_INACTIVE)}
              >
                <CategoryIcon slug={opt.value} size={16} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </FacetGroup>
    </Accordion>
  );
}

function FacetGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={id} className='border-figma-divider'>
      <AccordionTrigger className='py-3.5 font-semibold'>
        {title}
      </AccordionTrigger>
      <AccordionContent className='pb-4'>{children}</AccordionContent>
    </AccordionItem>
  );
}
