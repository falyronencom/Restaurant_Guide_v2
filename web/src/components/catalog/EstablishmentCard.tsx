import Image from 'next/image';

import type { PublicEstablishmentListing } from '@/lib/api/types';
import { formatRating, ratingColorClass } from '@/lib/establishment-helpers';
import { normalizeCategory, normalizeCuisine } from '@/lib/working-hours';

import { SmartLink } from '@/components/SmartLink';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';

import { OpenStatusBadge } from './OpenStatusBadge';

/**
 * EstablishmentCard — catalog result card, design "variant B" (rebalanced
 * bathtub): horizontal layout, image left (54%, 4:5), warm-beige content right,
 * uniform 20px radius, warm brand drop-shadow.
 *
 * Layout (content column, top→bottom):
 *   name (2-line clamp) + rating badge   → top row
 *   category · cuisine                    → subtitle
 *   open status                           → pinned to bottom (mt-auto)
 *   address (1-line ellipsis) + price     → bottom row
 *
 * Server Component; OpenStatusBadge (live status) + FavoriteButton are client
 * islands. href uses the establishment's own city/category slug for the
 * canonical URL, falling back to the page params when the projection is null.
 */

export function EstablishmentCard({
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
    <div className='group relative'>
      <SmartLink
        href={href}
        className='block transition-transform hover:-translate-y-0.5'
      >
        <article className='flex h-full overflow-hidden rounded-card shadow-[0_6px_20px_rgba(211,86,32,0.10)] transition-shadow group-hover:shadow-[0_8px_24px_rgba(211,86,32,0.16)]'>
          {/* Image column — left, 54% width, 4:5 portrait */}
          <div className='relative aspect-[4/5] w-[54%] shrink-0 overflow-hidden bg-muted'>
            {establishment.primary_image_url ? (
              <Image
                src={establishment.primary_image_url}
                alt={establishment.name}
                fill
                sizes='(max-width: 640px) 54vw, 300px'
                className='object-cover'
              />
            ) : (
              <div className='absolute inset-0 flex items-center justify-center text-muted-foreground'>
                <span className='text-caption-l'>Нет фото</span>
              </div>
            )}

            {establishment.has_promotion && (
              <span className='absolute bottom-3 left-3 rounded-[6px] bg-brand px-2 py-1 text-[11px] font-bold tracking-wider text-text-on-primary'>
                АКЦИЯ
              </span>
            )}
          </div>

          {/* Content column — right, beige */}
          <div className='flex min-w-0 flex-1 flex-col bg-figma-bg-warm p-m'>
            <div className='flex items-start justify-between gap-2'>
              <h3 className='line-clamp-2 font-display text-[17px] leading-[23px] font-normal text-foreground'>
                {establishment.name}
              </h3>
              {establishment.average_rating != null &&
              establishment.review_count > 0 && (
                <div
                  className={`flex size-[34px] shrink-0 items-center justify-center rounded-s text-[15px] leading-none font-semibold text-text-on-primary ${ratingColorClass(
                    establishment.average_rating,
                  )}`}
                >
                  {formatRating(establishment.average_rating)}
                </div>
              )}
            </div>

            {(primaryCategory || primaryCuisine) && (
              <p className='mt-1.5 text-body-s text-foreground'>
                {primaryCategory?.toLowerCase()}
                {primaryCategory && primaryCuisine && ' '}
                {primaryCuisine && (
                  <span className='text-figma-text-grey'>
                    · {primaryCuisine.toLowerCase()}
                  </span>
                )}
              </p>
            )}

            <div className='mt-auto pt-4'>
              <OpenStatusBadge
                workingHours={establishment.working_hours}
                status={establishment.status}
              />
            </div>

            <div className='mt-2 flex items-center justify-between gap-2'>
              <p className='min-w-0 truncate text-[13px] text-muted-foreground'>
                {establishment.address}
              </p>
              {establishment.price_range && (
                <span className='shrink-0 text-[15px] font-semibold text-foreground'>
                  {'₽'.repeat(establishment.price_range.length)}
                </span>
              )}
            </div>
          </div>
        </article>
      </SmartLink>
      {/* Favorites proving-action — sibling of the Link (valid markup; tap never
          navigates). Overlays the image column. */}
      <FavoriteButton
        establishmentId={establishment.id}
        className='absolute left-2 top-2 z-10'
      />
    </div>
  );
}
