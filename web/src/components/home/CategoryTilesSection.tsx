'use client';

import Link from 'next/link';

import { CategoryIcon } from '@/components/catalog/CategoryIcon';
import type { MetadataSlug } from '@/lib/api/types';
import { useSelectedCity } from '@/lib/city/selected-city';

type Props = {
  cities: MetadataSlug[];
  categories: MetadataSlug[];
};

/*
 * Large category-tile grid — a browse entry into the SEO catalog surfaces
 * (/[city]/[category]). Client Component so the tile links track the selected
 * city (useSelectedCity, localStorage) WITHOUT reading it server-side — that
 * would force `/` dynamic and break ISR. Before hydration the links target the
 * default city (Минск); after, the persisted choice. The visual language mirrors
 * the hero filter tiles (rounded-2xl + CategoryIcon) but larger — this is the
 * body's "куда сходить" discovery block, not a refinement control.
 *
 * Copy/visual sizing are sensible defaults; final polish is Segment E.
 */
export function CategoryTilesSection({ cities, categories }: Props) {
  const { city } = useSelectedCity(cities);

  return (
    <section className="mx-auto w-full max-w-6xl px-l py-xl">
      <h2 className="mb-l font-display text-display-s text-foreground">
        Куда сходить
      </h2>
      <div className="grid grid-cols-2 gap-m sm:grid-cols-3 md:grid-cols-5">
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={`/${city}/${c.slug}`}
            className="flex flex-col items-center gap-s rounded-2xl border border-border bg-figma-bg-warm p-l text-center text-body-m text-foreground transition-colors hover:border-brand hover:text-brand-dark"
          >
            <CategoryIcon slug={c.slug} size={40} />
            {c.name}
          </Link>
        ))}
      </div>
    </section>
  );
}
