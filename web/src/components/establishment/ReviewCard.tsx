import Image from 'next/image';
import { Star, MessageSquareReply } from 'lucide-react';

import type { PublicReview } from '@/lib/api/types';
import { formatDateRu } from '@/lib/establishment-helpers';
import { cn } from '@/lib/utils';

/**
 * ReviewCard — Server Component.
 *
 * A single review card shared between the detail-page ReviewCarousel
 * (horizontal scroll-snap row, content truncated) and the dedicated /reviews
 * route (vertical list, full content). The card owns only its content and the
 * common card chrome; layout-specific sizing (min-width, snap) is injected by
 * the caller via `className`.
 *
 * @param clamp - When true (carousel default) the body and partner response are
 *   line-clamped to keep cards compact in the grid. The /reviews page passes
 *   `false` to show reviews in full.
 */
export function ReviewCard({
  review,
  className,
  clamp = true,
}: {
  review: PublicReview;
  className?: string;
  clamp?: boolean;
}) {
  return (
    <article
      className={cn(
        'flex flex-col gap-s rounded-l border border-border bg-background p-m',
        className,
      )}
    >
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
        <p className={cn('text-body-m text-foreground', clamp && 'line-clamp-6')}>
          {review.content}
        </p>
      ) : null}

      {review.partner_response ? (
        <div className='inline-flex items-start gap-s rounded-m bg-brand/10 p-s text-body-s'>
          <MessageSquareReply
            className='mt-0.5 size-4 shrink-0 text-brand'
            aria-hidden='true'
          />
          <span className={cn('text-foreground', clamp && 'line-clamp-3')}>
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
