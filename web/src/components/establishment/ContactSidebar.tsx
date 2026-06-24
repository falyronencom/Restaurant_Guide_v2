/**
 * ContactSidebar — Server Component. Sticky right sidebar (desktop only).
 *
 * Design revision: one warm-beige card (rating square + verbal label + review
 * count, an orange phone CTA, and a white «Перейти на сайт» button) followed by
 * the MapPreview. Status / hours / price now live in the InfoCard facts grid,
 * so they are not repeated here. On mobile the sidebar is hidden (parent layout).
 */

import { Phone, Globe } from 'lucide-react';

import type { PublicEstablishmentDetail } from '@/lib/api/types';
import {
  ensureUrlScheme,
  formatRating,
  pluralizeReviews,
  ratingColorClass,
  ratingLabel,
} from '@/lib/establishment-helpers';

import { MapPreview } from './MapPreview';

export function ContactSidebar({
  establishment,
  citySlug,
}: {
  establishment: PublicEstablishmentDetail;
  /** URL slug of the city (authoritative — establishment.city_slug may be null). */
  citySlug: string;
}) {
  const label = ratingLabel(establishment.average_rating);

  return (
    <div className='flex flex-col gap-3.5'>
      <div className='flex flex-col gap-3.5 rounded-card bg-figma-bg-warm p-5'>
        {establishment.average_rating != null &&
        establishment.review_count > 0 ? (
          <div className='flex items-center gap-3'>
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-m text-[20px] leading-none font-semibold text-text-on-primary ${ratingColorClass(
                establishment.average_rating,
              )}`}
            >
              {formatRating(establishment.average_rating)}
            </span>
            <div className='min-w-0'>
              {label ? (
                <div className='text-headline-s font-semibold text-foreground'>
                  {label}
                </div>
              ) : null}
              <div className='text-body-s text-muted-foreground'>
                {pluralizeReviews(establishment.review_count)}
              </div>
            </div>
          </div>
        ) : null}

        {establishment.phone ? (
          <a
            href={`tel:${establishment.phone.replace(/\s/g, '')}`}
            className='inline-flex items-center justify-center gap-2 rounded-[14px] bg-brand px-l py-3.5 text-headline-s font-semibold text-text-on-primary transition-opacity hover:opacity-90'
          >
            <Phone className='size-5' aria-hidden='true' />
            {establishment.phone}
          </a>
        ) : null}

        {establishment.website ? (
          <a
            href={ensureUrlScheme(establishment.website)}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center justify-center gap-2 rounded-[14px] bg-background px-l py-3 text-body-m font-semibold text-foreground transition-colors hover:bg-muted'
          >
            <Globe className='size-4 text-brand' aria-hidden='true' />
            Перейти на сайт
          </a>
        ) : null}
      </div>

      <MapPreview
        latitude={establishment.latitude}
        longitude={establishment.longitude}
        address={establishment.address}
        citySlug={citySlug}
        slug={establishment.slug}
      />
    </div>
  );
}
