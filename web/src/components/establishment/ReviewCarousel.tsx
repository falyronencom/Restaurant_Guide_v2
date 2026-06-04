import Link from 'next/link';

import type { PublicReview } from '@/lib/api/types';
import {
  formatRating,
  pluralizeReviews,
  ratingLabel,
} from '@/lib/establishment-helpers';
import { ReviewCard } from './ReviewCard';

/**
 * ReviewCarousel — Server Component (Brief 4).
 *
 * Booking-style review block:
 *   - Header: overall rating square + total count + verbal label
 *     («Превосходно/Очень хорошо/...») + optional "Все N отзывов →" link to the
 *     dedicated /reviews route (Phase A) when more reviews exist than shown.
 *   - 3-card row на desktop, horizontal scroll-snap на mobile (CSS-only)
 *   - Each card (ReviewCard, shared with the /reviews route): avatar + author
 *     name + 5-star rating + content excerpt + date + optional partner-response.
 *   - Initial limit ≈5 reviews (per directive); the full list lives at /reviews.
 *
 * Author name: full name preserved (QP4 confirmed contract — no truncation).
 */

export function ReviewCarousel({
  reviews,
  totalCount,
  averageRating,
  reviewsHref,
}: {
  reviews: PublicReview[];
  totalCount: number;
  averageRating: number | null;
  reviewsHref?: string;
}) {
  const label = ratingLabel(averageRating);

  return (
    <div className='flex flex-col gap-m'>
      <div className='flex flex-wrap items-center gap-m'>
        <h2 className='text-display-s font-display'>Отзывы</h2>
        {averageRating != null ? (
          <span className='inline-flex items-center gap-s'>
            <span className='inline-flex size-10 items-center justify-center rounded-s bg-success-status text-headline-m font-medium text-text-on-primary'>
              {formatRating(averageRating)}
            </span>
            {label ? <span className='text-body-l text-foreground'>{label}</span> : null}
            <span className='text-body-m text-muted-foreground'>
              · {pluralizeReviews(totalCount)}
            </span>
          </span>
        ) : (
          <span className='text-body-m text-muted-foreground'>{pluralizeReviews(totalCount)}</span>
        )}
        {reviewsHref != null && totalCount > reviews.length ? (
          <Link
            href={reviewsHref}
            className='ml-auto text-body-m font-medium text-primary underline-offset-4 hover:underline'
          >
            Все {pluralizeReviews(totalCount)} →
          </Link>
        ) : null}
      </div>

      {reviews.length === 0 ? (
        <p className='rounded-l border border-border bg-figma-bg-warm p-l text-body-m text-muted-foreground'>
          Пока нет отзывов. Будьте первым, кто оставит отзыв!
        </p>
      ) : (
        <div
          className='-mx-l flex snap-x snap-mandatory gap-m overflow-x-auto px-l lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0'
          style={{ scrollbarWidth: 'none' }}
        >
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              className='min-w-[85%] snap-center lg:min-w-0'
            />
          ))}
        </div>
      )}
    </div>
  );
}
