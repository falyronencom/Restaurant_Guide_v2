import Image from 'next/image';
import Link from 'next/link';

import type { PublicEstablishmentListing } from '@/lib/api/types';
import { normalizeCategory, normalizeCuisine } from '@/lib/working-hours';

import { FavoriteButton } from '@/components/favorites/FavoriteButton';

import { OpenStatusBadge } from './OpenStatusBadge';

/**
 * EstablishmentCard — domain composite for the catalog page (Brief 3).
 *
 * Faithful port of mobile/lib/widgets/establishment_card.dart layout:
 *   horizontal "bathtub" — image (left, rounded LEFT corners) +
 *   beige content area (asymmetric right corners: top-right small,
 *   bottom-right large) + dual brand-shadow drop.
 *
 * Web adaptations per directive:
 *   - Image scales proportionally (responsive aspect-ratio), not fixed 172px
 *   - Card height flows from content, not hard-coded 291px
 *   - Distance/booking-indicator dropped (no geo SSR / no booking action on
 *     web yet). The favorite affordance was RESTORED in Phase B Slice 1
 *     (Google auth) as a FavoriteButton island overlaid on the image column.
 *   - href uses establishment's own city_slug/category_slug for canonical
 *     URL (primary category); falls back to page params when projection
 *     returned null (production seed has English category values that
 *     fail backend's Cyrillic→slug mapping — Brief 3 discovery)
 *
 * Server Component. OpenStatusBadge is a client island for live status.
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
      <Link
        href={href}
        className='block transition-transform hover:-translate-y-0.5'
      >
      <article
        className={
          // Dual brand-shadow drop @ ~4% alpha (mobile #0AD35620).
          // Tailwind v4 arbitrary value: underscore separator, slash for alpha.
          'flex h-full overflow-hidden shadow-[4px_4px_15px_2px_rgb(211_86_32_/_4%),-4px_-4px_15px_2px_rgb(211_86_32_/_4%)] transition-shadow group-hover:shadow-[6px_6px_18px_3px_rgb(211_86_32_/_8%),-6px_-6px_18px_3px_rgb(211_86_32_/_8%)]'
        }
      >
        {/* Image column — left, "bathtub" clip via border-radius on LEFT corners */}
        <div className='relative aspect-[172/291] w-2/5 shrink-0 overflow-hidden rounded-l-[40px] bg-muted'>
          {establishment.primary_image_url ? (
            <Image
              src={establishment.primary_image_url}
              alt={establishment.name}
              fill
              sizes='(max-width: 640px) 40vw, (max-width: 1024px) 20vw, 13vw'
              className='object-cover'
            />
          ) : (
            <div className='absolute inset-0 flex items-center justify-center text-muted-foreground'>
              <span className='text-caption-l'>Нет фото</span>
            </div>
          )}

          {establishment.has_promotion && (
            <span
              className={
                // АКЦИЯ badge — bottom-left of image, brand orange, white text.
                // Padding/radius/font matches mobile constants in establishment_card.dart.
                'absolute bottom-3 left-2 rounded-[6px] bg-brand px-2 py-1 text-[11px] font-bold tracking-wider text-text-on-primary'
              }
            >
              АКЦИЯ
            </span>
          )}
        </div>

        {/* Content column — right, beige bg, asymmetric right corners */}
        <div className='relative flex-1 rounded-tr-[10px] rounded-br-[40px] bg-figma-bg-warm px-m pt-l pb-m'>
          {/* Main column — name + meta + status + address.
              Right padding offsets the absolute-positioned rating+price column. */}
          <div className='flex flex-col gap-1 pr-12'>
            <h3
              className={
                // Mobile name: Unbounded 18px w400 (NOT headline-m w600 — F2).
                // Inline arbitrary per Coordinator decision (no new token for single use).
                'line-clamp-2 font-display text-[18px] leading-[25px] font-normal text-foreground'
              }
            >
              {establishment.name}
            </h3>

            {primaryCategory && (
              <p className='text-body-s text-foreground'>
                {primaryCategory.toLowerCase()}
              </p>
            )}

            {primaryCuisine && (
              <p className='text-body-s text-figma-text-grey'>
                {`{${primaryCuisine}}`}
              </p>
            )}

            <div className='mt-5'>
              <OpenStatusBadge
                workingHours={establishment.working_hours}
                status={establishment.status}
              />
            </div>

            <p className='mt-4 line-clamp-2 text-body-m text-foreground underline underline-offset-2'>
              {establishment.address}
            </p>
          </div>

          {/* Absolute top-right: rating square + price column */}
          <div className='absolute top-l right-m flex flex-col items-center gap-1'>
            {establishment.average_rating != null && (
              <div className='flex size-[31px] items-center justify-center rounded-s bg-success-status text-[16px] leading-none text-text-on-primary'>
                {formatRating(establishment.average_rating)}
              </div>
            )}
            {establishment.price_range && (
              <span className='text-[15px] leading-none text-foreground'>
                {establishment.price_range}
              </span>
            )}
          </div>
        </div>
      </article>
      </Link>
      {/* Favorites proving-action — sibling of the Link (valid markup; tap
          never navigates). Overlays the image column (left 2/5 of the card). */}
      <FavoriteButton
        establishmentId={establishment.id}
        className='absolute left-2 top-2 z-10'
      />
    </div>
  );
}

/**
 * Format rating as Russian-locale string with comma decimal separator.
 * Mirrors mobile: `rating.toStringAsFixed(1).replaceAll('.', ',')`.
 * Example: 4.8 → "4,8".
 */
function formatRating(rating: number): string {
  return rating.toFixed(1).replace('.', ',');
}
