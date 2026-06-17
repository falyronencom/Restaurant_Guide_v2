import Link from 'next/link';

import type { MetadataSlug } from '@/lib/api/types';

type Props = {
  cities: MetadataSlug[];
};

/*
 * City selector section — warm tiles linking to each city's overview (an SEO
 * entry surface). Server-rendered (static links). Visual polish (city imagery,
 * richer tiles) is deferred to Segment E; this is the sensible-default frame.
 */
export function CitySelector({ cities }: Props) {
  return (
    <section className="mx-auto w-full max-w-6xl px-l py-xxl">
      <h2 className="font-display text-display-s text-foreground">
        Выберите город
      </h2>
      <p className="mt-s text-body-m text-text-secondary">
        Откройте лучшие заведения в вашем городе
      </p>

      <ul className="mt-l grid grid-cols-2 gap-m sm:grid-cols-3 lg:grid-cols-4">
        {cities.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/${c.slug}`}
              className="flex min-h-[112px] items-end rounded-2xl bg-figma-bg-warm p-l text-headline-l text-foreground transition-colors hover:bg-brand/10"
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
