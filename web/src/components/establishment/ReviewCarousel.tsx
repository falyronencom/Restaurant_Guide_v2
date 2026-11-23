import Link from 'next/link';
import type { ReactNode } from 'react';

import type { PublicReview } from '@/lib/api/types';
import {
  formatRating,
  pluralizeReviews,
  ratingColorClass,
  ratingLabel,
} from '@/lib/establishment-helpers';

import { OnlyForAuthor } from './OnlyForAuthor';
import { OwnReviewControls } from './OwnReviewControls';
import { ReviewCard } from './ReviewCard';
import { WriteReviewCta } from './WriteReviewCta';

/**
 * ReviewCarousel — Server Component.
 *
 * Header: overall rating badge + verbal label + total count + «Все N отзывов →»
 * link to the dedicated /reviews route + the write-review CTA (reviews-write
 * Slice 1 — a client island that opens the modal, or shows «Ваш отзыв» when the
 * user already reviewed this place). Body: a 2-column grid on desktop, a
 * horizontal scroll-snap row on mobile (CSS-only). Every card also gets the
 * OwnReviewControls island in its footer slot (Slice 2) — it renders edit/delete
 * only on the session user's own review, nothing otherwise.
 *
 * `reviews` are the first reviews WITH TEXT; `totalCount` is the card's
 * `review_count` — every review, a rating alone included (В1 = А). A card
 * whose reviews are all ratings without text says «Пока только оценки», and
 * the header's «Все N отзывов →» leads to them.
 *
 * `authorOnly` — reviews of one rating among the latest (authorOnlyReviews):
 * each is shown first, to its author alone (OnlyForAuthor), with
 * «Редактировать» / «Удалить», and the CTA reads it as «Ваш отзыв» (Trunk's
 * decision 22.11.2026). Every other visitor sees nothing of them.
 */

export function ReviewCarousel({
  reviews,
  authorOnly = [],
  totalCount,
  averageRating,
  reviewsHref,
  establishmentId,
  establishmentName,
  detailPath,
}: {
  reviews: PublicReview[];
  authorOnly?: PublicReview[];
  totalCount: number;
  averageRating: number | null;
  reviewsHref?: string;
  establishmentId: string;
  establishmentName: string;
  detailPath: string;
}) {
  const label = ratingLabel(averageRating);

  const reviewCard = (review: PublicReview) => (
    <ReviewCard
      key={review.id}
      review={review}
      className='min-w-[85%] snap-center lg:min-w-0'
      actions={
        <OwnReviewControls
          review={review}
          establishmentId={establishmentId}
          establishmentName={establishmentName}
          detailPath={detailPath}
        />
      }
    />
  );

  const reviewRow = (cards: ReactNode) => (
    <div
      className='-mx-l flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-l lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0'
      style={{ scrollbarWidth: 'none' }}
    >
      {cards}
    </div>
  );

  // The author's own reviews of one rating come first, each seen by its
  // author alone.
  const authorOnlyCards = authorOnly.map((review) => (
    <OnlyForAuthor key={review.id} authorIds={[review.author.id]}>
      {reviewCard(review)}
    </OnlyForAuthor>
  ));

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <h2 className='font-display text-[20px] font-semibold'>Отзывы</h2>
        {averageRating != null && totalCount > 0 ? (
          <span className='inline-flex items-center gap-2'>
            <span
              className={`flex size-[34px] items-center justify-center rounded-[var(--radius-s)] text-[15px] leading-none font-semibold text-text-on-primary ${ratingColorClass(
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
        <div className='ml-auto flex items-center gap-3'>
          {reviewsHref != null && totalCount > reviews.length ? (
            <Link
              href={reviewsHref}
              className='text-body-m font-medium text-brand underline-offset-4 hover:underline'
            >
              Все {pluralizeReviews(totalCount)} →
            </Link>
          ) : null}
          <WriteReviewCta
            establishmentId={establishmentId}
            establishmentName={establishmentName}
            detailPath={detailPath}
            reviews={[...reviews, ...authorOnly]}
          />
        </div>
      </div>

      {reviews.length === 0 ? (
        <>
          <p className='rounded-card bg-figma-bg-warm p-l text-body-m text-muted-foreground'>
            {totalCount > 0
              ? 'Пока только оценки'
              : 'Пока нет отзывов. Будьте первым, кто оставит отзыв!'}
          </p>
          {authorOnly.length > 0 ? (
            // The row itself only for an author: an empty one would still
            // add a gap under «Пока только оценки» for everyone else.
            <OnlyForAuthor
              authorIds={authorOnly.map((review) => review.author.id)}
            >
              {reviewRow(authorOnlyCards)}
            </OnlyForAuthor>
          ) : null}
        </>
      ) : (
        reviewRow([...authorOnlyCards, ...reviews.map(reviewCard)])
      )}
    </div>
  );
}
