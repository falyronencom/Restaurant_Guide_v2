import Link from 'next/link';

import type { PublicReview } from '@/lib/api/types';
import {
  formatRating,
  pluralizeReviews,
  ratingColorClass,
  ratingLabel,
} from '@/lib/establishment-helpers';

import { ReviewCard } from './ReviewCard';

/**
 * ReviewCarousel — Server Component.
 *
 * Header: overall rating badge + verbal label + total count + «Все N отзывов →»
 * link to the dedicated /reviews route. Body: a 2-column grid on desktop, a
 * horizontal scroll-snap row on mobile (CSS-only). Footer: «Оставить отзыв»
 * outline CTA (→ the reviews route, where the submit flow will live).
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
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <h2 className='font-display text-[20px] font-semibold'>Отзывы</h2>
        {averageRating != null ? (
          <span className='inline-flex items-center gap-2'>
            <span
              className={`flex size-[34px] items-center justify-center rounded-s text-[15px] leading-none font-semibold text-text-on-primary ${ratingColorClass(
                averageRating,
              )}`}
            >
              {formatRating(averageRating)}
            </span>
            {label ? (
              <span className='text-body-l font-semibold text-foreground'>
                {label}
              </span>
            ) : null}
            <span className='text-body-m text-muted-foreground'>
              · {pluralizeReviews(totalCount)}
            </span>
          </span>
        ) : (
          <span className='text-body-m text-muted-foreground'>
            {pluralizeReviews(totalCount)}
          </span>
        )}
        {reviewsHref != null && totalCount > reviews.length ? (
          <Link
            href={reviewsHref}
            className='ml-auto text-body-m font-medium text-brand underline-offset-4 hover:underline'
          >
            Все {pluralizeReviews(totalCount)} →
          </Link>
        ) : null}
      </div>

      {reviews.length === 0 ? (
        <p className='rounded-card bg-figma-bg-warm p-l text-body-m text-muted-foreground'>
          Пока нет отзывов. Будьте первым, кто оставит отзыв!
        </p>
      ) : (
        <div
          className='-mx-l flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-l lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0'
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

      {reviewsHref != null ? (
        <Link
          href={reviewsHref}
          className='inline-flex w-fit items-center gap-2 rounded-[14px] border border-brand px-5 py-3 text-body-l font-semibold text-brand transition-colors hover:bg-brand/5'
        >
          Оставить отзыв
        </Link>
      ) : null}
    </div>
  );
}
