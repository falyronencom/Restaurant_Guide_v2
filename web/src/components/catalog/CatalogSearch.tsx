'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CitySheet } from '@/components/home/CitySheet';
import type { MetadataSlug } from '@/lib/api/types';
import type { SearchParams } from '@/lib/catalog-params';

type Props = {
  citySlug: string;
  /** Catalog route segment. Omitted on the city page (/{city}), where search
   *  and city changes stay category-less. */
  categorySlug?: string;
  cities: MetadataSlug[];
  searchParams: SearchParams;
};

// Glass pill over the photo banner — the catalog variant of the hero city chip.
// self-start keeps it content-width when the cluster stacks on mobile.
const GLASS_TRIGGER =
  'flex items-center gap-s self-start rounded-2xl border border-white/35 bg-white/[0.12] px-4 py-[13px] text-label-l text-white backdrop-blur-[4px] transition-colors hover:bg-white/20 sm:self-auto';

/*
 * Catalog banner search cluster — the interactive island of CatalogHero. Unlike
 * the home HeroSearch this has no «Фильтры» pill (refinement lives in the
 * sidebar FilterShelf) and it navigates WITHIN the catalog:
 *   - city pill  → /{newCity}/{category}  (city is part of the SEO route)
 *   - search box → /{city}/{category}?search=…
 * Both preserve the currently-applied facets (cuisine/price/hours/features) and
 * reset pagination, mirroring the URL contract the page reads server-side.
 */
export function CatalogSearch({
  citySlug,
  categorySlug,
  cities,
  searchParams,
}: Props) {
  const router = useRouter();
  const initial =
    typeof searchParams.search === 'string' ? searchParams.search : '';
  const [term, setTerm] = useState(initial);

  function navigate(city: string, search: string | undefined) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value == null) continue;
      const flat = Array.isArray(value) ? value.join(',') : value;
      if (flat) params.set(key, flat);
    }
    if (search) params.set('search', search);
    else params.delete('search');
    params.delete('page'); // a new search / city always returns to page 1
    const qs = params.toString();
    const base = categorySlug ? `/${city}/${categorySlug}` : `/${city}`;
    router.push(qs ? `${base}?${qs}` : base);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <CitySheet
        cities={cities}
        value={citySlug}
        onChange={(slug) => navigate(slug, term.trim() || undefined)}
        triggerClassName={GLASS_TRIGGER}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(citySlug, term.trim() || undefined);
        }}
        className="flex w-full max-w-[544px] items-stretch overflow-hidden rounded-2xl bg-white shadow-[0_14px_34px_rgba(0,0,0,0.22)]"
      >
        <input
          type="search"
          name="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Найти заведение"
          aria-label="Поиск заведения"
          className="min-w-0 flex-1 bg-transparent px-5 py-3.5 text-body-l text-foreground outline-none placeholder:text-text-tertiary"
        />
        <button
          type="submit"
          aria-label="Найти"
          className="flex items-center justify-center bg-brand px-[22px] text-[22px] text-white transition-colors hover:bg-brand-dark"
        >
          ›
        </button>
      </form>
    </div>
  );
}
