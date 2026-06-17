'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MetadataSlug } from '@/lib/api/types';
import { useSelectedCity } from '@/lib/city/selected-city';
import { PRICE_VALUES } from '@/lib/facets';

import { HeroFilters, type HeroFilterValue } from './HeroFilters';

type Props = {
  cities: MetadataSlug[];
  cuisines: MetadataSlug[];
};

const EMPTY_FILTERS: HeroFilterValue = {
  cuisines: [],
  priceRange: [],
  hours: undefined,
};

/*
 * Hero search cluster — the interactive island of the home hero. Owns the
 * selected city (shared via useSelectedCity with persistence), the search term,
 * and the refinement filters.
 *
 * Single navigation point: ONLY the orange Search button loads results (city is
 * context, the «Фильтры» panel is refinement — neither navigates on its own).
 * serverFetch is server-only, so this NAVIGATES (router.push) rather than
 * calling the API. The target mirrors the results-page URL contract exactly:
 *   /{city}?search=<term>&cuisine=<slugs>&priceRange=<$,$$>&hours=<bucket>
 * Multi facets are comma-joined and omitted when none OR all are selected
 * ("all" == no constraint), matching FilterShelf.
 */
export function HeroSearch({ cities, cuisines }: Props) {
  const router = useRouter();
  const { city, setCity } = useSelectedCity(cities);
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<HeroFilterValue>(EMPTY_FILTERS);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    const q = term.trim();
    if (q) params.set('search', q);
    if (
      filters.cuisines.length > 0 &&
      filters.cuisines.length < cuisines.length
    ) {
      params.set('cuisine', filters.cuisines.join(','));
    }
    if (
      filters.priceRange.length > 0 &&
      filters.priceRange.length < PRICE_VALUES.length
    ) {
      params.set('priceRange', filters.priceRange.join(','));
    }
    if (filters.hours) params.set('hours', filters.hours);
    const qs = params.toString();
    router.push(qs ? `/${city}?${qs}` : `/${city}`);
  }

  return (
    <>
      {/* City + Filters pills — mobile-faithful binding */}
      <div className="mt-xl flex items-center gap-m">
        <span className="relative inline-flex items-center">
          <select
            aria-label="Выбрать город"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="cursor-pointer appearance-none rounded-full border border-white/70 bg-transparent py-s pl-l pr-9 text-label-l text-white outline-none"
          >
            {cities.map((c) => (
              <option key={c.slug} value={c.slug} className="text-text-primary">
                {c.name}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-white/70"
          >
            ▾
          </span>
        </span>

        <HeroFilters cuisines={cuisines} value={filters} onChange={setFilters} />
      </div>

      {/* Search — orange button = the single action that loads results */}
      <form
        onSubmit={onSubmit}
        className="mt-m flex w-full max-w-[34rem] items-stretch overflow-hidden rounded-full bg-white shadow-xl"
      >
        <input
          type="search"
          name="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Найти заведение"
          aria-label="Поиск заведения"
          className="flex-1 bg-transparent px-l py-m text-body-l text-foreground outline-none placeholder:text-text-tertiary"
        />
        <button
          type="submit"
          aria-label="Найти"
          className="flex items-center justify-center bg-brand px-l text-2xl text-white transition-colors hover:bg-brand-dark"
        >
          ›
        </button>
      </form>
    </>
  );
}
