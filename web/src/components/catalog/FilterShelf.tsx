'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  ATTRIBUTE_OPTIONS,
  ATTRIBUTE_VALUES,
  HOURS_OPTIONS,
  PRICE_OPTIONS,
  PRICE_VALUES,
  type FacetOption,
} from '@/lib/facets';
import { cn } from '@/lib/utils';

/*
 * FilterShelf — searchParams-driven facet shelf for the catalog page.
 *
 * Client island (the only interactive part of the otherwise-Server catalog
 * page). It performs NO client-side filtering of results: every toggle mutates
 * the URL query-string and the Server Component re-fetches with the new params
 * (mirrors mobile — collect selection → params → backend applies OR/AND).
 *
 * Facets: price (multi, OR-within), cuisine (multi, OR-within), working-hours
 * (single-select bucket), and attributes/«Дополнительно» (multi). Group
 * AND-between is applied by the backend. Distance stays out of v1 scope.
 *
 * URL contract mirrors CatalogPagination.buildHref: preserve all sibling params,
 * reset `page` to 1 on every facet change, and keep multi-value facets as a
 * single comma-joined key (not repeated keys).
 */

type Selected = {
  cuisines: string[];
  priceRange: string[];
  features: string[];
  hours: string | undefined;
};

export function FilterShelf({
  basePath,
  searchParams,
  cuisineOptions,
  selected,
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  cuisineOptions: readonly FacetOption[];
  selected: Selected;
}) {
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
  // If the toggle ends up selecting EVERY option, omit the param — "all selected"
  // equals "no constraint" on the backend, so the full value list is never shipped
  // to the URL (Informed Directive: «выбрать все» → опустить param).
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
      // OR-within-group facets (cuisine/price): "all selected" == "no
      // constraint" → omit the param. AND-between facets (features): "all
      // selected" is a real, maximally-restrictive filter → keep it; omit only
      // when empty.
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
      defaultValue={['price', 'cuisine', 'hours', 'features']}
      className='rounded-m border border-border bg-background px-m'
      aria-label='Фильтры'
    >
      <FacetGroup id='price' title='Средний чек'>
        {PRICE_OPTIONS.map((opt) => (
          <CheckRow
            key={opt.value}
            id={`price-${opt.value}`}
            label={opt.label}
            checked={selected.priceRange.includes(opt.value)}
            onToggle={() =>
              toggleMulti('priceRange', selected.priceRange, opt.value, PRICE_VALUES)
            }
          />
        ))}
      </FacetGroup>

      <FacetGroup
        id='cuisine'
        title='Кухня'
        contentClassName='grid grid-cols-1 gap-x-m gap-y-s pt-s sm:grid-cols-2'
      >
        {cuisineOptions.map((opt) => (
          <CheckRow
            key={opt.value}
            id={`cuisine-${opt.value}`}
            label={opt.label}
            checked={selected.cuisines.includes(opt.value)}
            onToggle={() =>
              toggleMulti('cuisine', selected.cuisines, opt.value, cuisineValues)
            }
          />
        ))}
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
                className={cn(
                  'rounded-s border px-m py-s text-body-m transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </FacetGroup>

      <FacetGroup
        id='features'
        title='Дополнительно'
        contentClassName='grid grid-cols-1 gap-x-m gap-y-s pt-s sm:grid-cols-2'
      >
        {ATTRIBUTE_OPTIONS.map((opt) => (
          <CheckRow
            key={opt.value}
            id={`feature-${opt.value}`}
            label={opt.label}
            checked={selected.features.includes(opt.value)}
            onToggle={() =>
              toggleMulti(
                'features',
                selected.features,
                opt.value,
                ATTRIBUTE_VALUES,
                false,
              )
            }
          />
        ))}
      </FacetGroup>
    </Accordion>
  );
}

function FacetGroup({
  id,
  title,
  contentClassName = 'flex flex-col gap-s pt-s',
  children,
}: {
  id: string;
  title: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={id}>
      <AccordionTrigger className='text-label-m'>{title}</AccordionTrigger>
      <AccordionContent>
        <div className={contentClassName}>{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

function CheckRow({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className='flex items-center gap-s py-1'>
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <Label htmlFor={id} className='cursor-pointer font-normal text-body-m'>
        {label}
      </Label>
    </div>
  );
}
