/**
 * ReviewCarousel — Server Component (Brief 4).
 *
 * Booking-style review block:
 *   - Header: overall rating square + total count + verbal label
 *     («Превосходно/Очень хорошо/...»)
 *   - 3-card row на desktop, horizontal scroll-snap на mobile (CSS-only)
 *   - Each card: avatar + author name + 5-star rating + content excerpt +
 *     date + optional partner-response line
 *   - Initial limit ≈5 reviews (per directive). No «show all» link in Brief 4
 *     — dedicated reviews route deferred.
 *
 * Author name: full name preserved (QP4 confirmed contract — no truncation).
 * Date rendered Russian-locale via formatDateRu.
 */

import Image from 'next/image';
import { Star, MessageSquareReply } from 'lucide-react';

import type { PublicReview } from '@/lib/api/types';
import {
  formatRating,
  formatDateRu,
  pluralizeReviews,
  ratingLabel,
} from '@/lib/establishment-helpers';

export function ReviewCarousel({
  reviews,
  totalCount,
  averageRating,
}: {
  reviews: PublicReview[];
  totalCount: number;
  averageRating: number | null;
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
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: PublicReview }) {
  return (
    <article className='flex min-w-[85%] snap-center flex-col gap-s rounded-l border border-border bg-background p-m lg:min-w-0'>
      <header className='flex items-start gap-s'>
        <div className='relative size-10 shrink-0 overflow-hidden rounded-full bg-figma-navy'>
          {review.author.avatar_url ? (
            <Image
              src={review.author.avatar_url}
              alt={review.author.name}
              fill
              sizes='40px'
              className='object-cover'
            />
          ) : (
            <span className='flex size-full items-center justify-center font-display text-headline-m text-text-on-primary'>
              {review.author.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className='flex flex-1 flex-col gap-1'>
          <span className='text-body-m font-medium text-foreground'>
            {review.author.name}
          </span>
          <StarRating rating={review.rating} />
        </div>
        <time
          dateTime={review.created_at}
          className='text-caption-m text-muted-foreground'
        >
          {formatDateRu(review.created_at)}
        </time>
      </header>

      {review.content ? (
        <p className='line-clamp-6 text-body-m text-foreground'>{review.content}</p>
      ) : null}

      {review.partner_response ? (
        <div className='inline-flex items-start gap-s rounded-m bg-brand/10 p-s text-body-s'>
          <MessageSquareReply
            className='mt-0.5 size-4 shrink-0 text-brand'
            aria-hidden='true'
          />
          <span className='line-clamp-3 text-foreground'>
            <span className='font-medium'>Ответ заведения: </span>
            {review.partner_response}
          </span>
        </div>
      ) : null}
    </article>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className='flex items-center gap-0.5' aria-label={`Оценка: ${rating} из 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={
            n <= rating
              ? 'size-4 fill-brand text-brand'
              : 'size-4 text-muted-foreground'
          }
          aria-hidden='true'
        />
      ))}
    </div>
  );
}
