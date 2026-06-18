'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MetadataSlug } from '@/lib/api/types';
import { useSelectedCity } from '@/lib/city/selected-city';
import { PRICE_VALUES } from '@/lib/facets';

import { CitySheet } from './CitySheet';
import { HeroFilters, type HeroFilterValue } from './HeroFilters';

type Props = {
  cities: MetadataSlug[];
  categories: MetadataSlug[];
  cuisines: MetadataSlug[];
};

const EMPTY_FILTERS: HeroFilterValue = {
  cuisines: [],
  priceRange: [],
  features: [],
  hours: undefined,
};

/*
 * Hero search cluster — the interactive island of the home hero. Owns the
 * selected city (shared via useSelectedCity with persistence), the search term,
 * the selected establishment category, and the refinement filters.
 *
 * Single navigation point: ONLY the orange Search button loads results (city is
 * context, the «Фильтры» panel is refinement — neither navigates on its own).
 * serverFetch is server-only, so this NAVIGATES (router.push) rather than
 * calling the API. The target mirrors the results-page URL contract exactly:
 *   - category chosen → /{city}/{category}?<facets>   (category = SEO path)
 *   - no category     → /{city}?<facets>
 * where <facets> = search / cuisine / priceRange / hours / features. Multi
 * facets are comma-joined. cuisine/price are omitted when none OR all are
 * selected ("all" == no constraint for OR-within-group). features are AND-ed by
 * the backend, so they are omitted only when none is selected (all-selected is a
 * meaningful, maximally-restrictive filter — NOT "no constraint").
 */
export function HeroSearch({ cities, categories, cuisines }: Props) {
  const router = useRouter();
  const { city, setCity } = useSelectedCity(cities);
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string | null>(null);
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
    if (filters.features.length > 0) {
      params.set('features', filters.features.join(','));
    }
    if (filters.hours) params.set('hours', filters.hours);
    const qs = params.toString();
    const base = category ? `/${city}/${category}` : `/${city}`;
    router.push(qs ? `${base}?${qs}` : base);
  }

  return (
    <>
      {/* City + Filters pills — mobile-faithful binding */}
      <div className="mt-xl flex items-center gap-m">
        <CitySheet cities={cities} value={city} onChange={setCity} />

        <HeroFilters
          categories={categories}
          cuisines={cuisines}
          value={filters}
          onChange={setFilters}
          selectedCategory={category}
          onCategoryChange={setCategory}
        />
      </div>

      {/* Search — orange button = the single action that loads results */}
      <form
        onSubmit={onSubmit}
        className="mt-m flex w-full max-w-[34rem] items-stretch overflow-hidden rounded-2xl bg-white shadow-xl"
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
