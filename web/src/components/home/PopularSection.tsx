import Link from 'next/link';

import { FavoritesProvider } from '@/components/favorites/FavoritesProvider';
import { getCatalog } from '@/lib/api/endpoints/establishments';

import { PopularCard } from './PopularCard';

/*
 * "Популярное" — the home body's first audience hook (users). Top-rated
 * establishments of the DEFAULT city, rendered STATICALLY so `/` stays ISR
 * (○ Static). The selected-city chip in the hero does NOT retarget this list:
 * reading the chosen city would need client/cookie state in a server render and
 * break ISR. Per-selected-city refinement is deferred to Segment E / Phase B via
 * a Route Handler (Directive §4; memory project_web_vitrine_popular_isr_decision).
 *
 * sort_by:'rating' is the backend's Bayesian-weighted default, so this is a
 * genuine "popular", not a raw average. The card list MUST sit under
 * FavoritesProvider with the visible ids — EstablishmentCard mounts a
 * FavoriteButton whose useFavorites() throws outside the provider (the hard-dep
 * proven in ResultsView). AuthProvider is already supplied by the root layout.
 */

const POPULAR_CITY = 'minsk';
const POPULAR_CITY_NAME = 'Минске';
const POPULAR_LIMIT = 6;

export async function PopularSection() {
  const { establishments } = await getCatalog({
    city: POPULAR_CITY,
    sort_by: 'rating',
    limit: POPULAR_LIMIT,
  });

  // No data (cold seed / fetch hiccup) → render nothing rather than an empty
  // shell; the rest of the home body still stands.
  if (establishments.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-6xl px-l py-xl">
      <div className="mb-l flex items-baseline justify-between gap-m">
        <h2 className="font-display text-display-s text-foreground">
          Популярное в {POPULAR_CITY_NAME}
        </h2>
        <Link
          href={`/${POPULAR_CITY}`}
          className="shrink-0 text-body-m text-brand transition-colors hover:text-brand-dark"
        >
          Все заведения →
        </Link>
      </div>

      <FavoritesProvider establishmentIds={establishments.map((e) => e.id)}>
        <div className="grid grid-cols-1 gap-l sm:grid-cols-2 lg:grid-cols-3">
          {establishments.map((establishment) => (
            <PopularCard
              key={establishment.id}
              establishment={establishment}
              fallbackCitySlug={POPULAR_CITY}
              fallbackCategorySlug="restaurants"
            />
          ))}
        </div>
      </FavoritesProvider>
    </section>
  );
}
