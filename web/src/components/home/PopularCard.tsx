import Image from 'next/image';

import { SmartLink } from '@/components/SmartLink';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { OpenStatusBadge } from '@/components/catalog/OpenStatusBadge';
import type { PublicEstablishmentListing } from '@/lib/api/types';
import { normalizeCategory, normalizeCuisine } from '@/lib/working-hours';

/*
 * Vertical "featured" card — used ONLY in the home «Популярное» section. A
 * deliberate counterpoint to the horizontal "bathtub" EstablishmentCard of the
 * search results (photo on top, info below). This differentiates the homepage
 * showcase from the catalog — it reads as a curated feature, not a duplicate of
 * the results list — and sits better in the 3-up grid.
 *
 * Shares the domain bits with EstablishmentCard (slug href + fallback,
 * normalizeCategory/Cuisine, OpenStatusBadge, FavoriteButton); only the layout
 * differs. Server Component; FavoriteButton + OpenStatusBadge are the client
 * islands (so the section still requires the FavoritesProvider wrap).
 */
export function PopularCard({
  establishment,
  fallbackCitySlug,
  fallbackCategorySlug,
}: {
  establishment: PublicEstablishmentListing;
  fallbackCitySlug: string;
  fallbackCategorySlug: string;
}) {
  const citySlug = establishment.city_slug ?? fallbackCitySlug;
  const categorySlug = establishment.category_slug ?? fallbackCategorySlug;
  const href = `/${citySlug}/${categorySlug}/${establishment.slug}`;

  const primaryCategory = establishment.categories[0]
    ? normalizeCategory(establishment.categories[0])
    : null;
  const primaryCuisine = establishment.cuisines[0]
    ? normalizeCuisine(establishment.cuisines[0])
    : null;

  return (
    <div className="group relative">
      <SmartLink
        href={href}
        className="block transition-transform hover:-translate-y-0.5"
      >
        <article
          className={
            // Same dual brand-shadow drop as EstablishmentCard, full rounded-2xl
            // (no asymmetric bathtub corners — this card is vertical).
            'flex h-full flex-col overflow-hidden rounded-2xl bg-figma-bg-warm shadow-[4px_4px_15px_2px_rgb(211_86_32_/_4%),-4px_-4px_15px_2px_rgb(211_86_32_/_4%)] transition-shadow group-hover:shadow-[6px_6px_18px_3px_rgb(211_86_32_/_8%),-6px_-6px_18px_3px_rgb(211_86_32_/_8%)]'
          }
        >
          {/* Photo — top, full width */}
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
            {establishment.primary_image_url ? (
              <Image
                src={establishment.primary_image_url}
                alt={establishment.name}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <span className="text-caption-l">Нет фото</span>
              </div>
            )}

            {establishment.average_rating != null && (
              <span className="absolute top-2 right-2 flex h-[31px] min-w-[31px] items-center justify-center rounded-s bg-success-status px-1.5 text-[16px] leading-none text-text-on-primary">
                {formatRating(establishment.average_rating)}
              </span>
            )}

            {establishment.has_promotion && (
              <span className="absolute bottom-2 left-2 rounded-[6px] bg-brand px-2 py-1 text-[11px] font-bold tracking-wider text-text-on-primary">
                АКЦИЯ
              </span>
            )}
          </div>

          {/* Content — below the photo */}
          <div className="flex flex-1 flex-col gap-1 p-m">
            <h3 className="line-clamp-1 font-display text-[18px] leading-[25px] font-normal text-foreground">
              {establishment.name}
            </h3>

            <div className="flex flex-wrap items-center gap-x-s text-body-s">
              {primaryCategory && (
                <span className="text-foreground">
                  {primaryCategory.toLowerCase()}
                </span>
              )}
              {primaryCuisine && (
                <span className="text-figma-text-grey">{`{${primaryCuisine}}`}</span>
              )}
            </div>

            <div className="mt-1 flex items-center justify-between gap-s">
              <OpenStatusBadge
                workingHours={establishment.working_hours}
                status={establishment.status}
              />
              {establishment.price_range && (
                <span className="text-[15px] leading-none text-foreground">
                  {establishment.price_range}
                </span>
              )}
            </div>

            <p className="mt-1 line-clamp-1 text-body-m text-foreground underline underline-offset-2">
              {establishment.address}
            </p>
          </div>
        </article>
      </SmartLink>
      {/* Favorites island — sibling of the Link (tap never navigates). */}
      <FavoriteButton
        establishmentId={establishment.id}
        className="absolute left-2 top-2 z-10"
      />
    </div>
  );
}

/**
 * Russian-locale rating ("4,8"). Mirrors EstablishmentCard's local helper —
 * duplicated rather than exported to keep that card untouched.
 */
function formatRating(rating: number): string {
  return rating.toFixed(1).replace('.', ',');
}
