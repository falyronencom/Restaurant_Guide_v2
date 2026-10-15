import { Star } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PublicReview } from '@/lib/api/types';
import { avatarSource } from '@/lib/avatar-source';
import { formatDateRu } from '@/lib/establishment-helpers';
import { cn } from '@/lib/utils';

import { ReviewAvatar } from './ReviewAvatar';

/**
 * ReviewCard — Server Component. Shared by the detail-page ReviewCarousel
 * (compact, clamped) and the /reviews route (full). Warm-beige card: author
 * avatar (photo or colored initial — the ReviewAvatar island) + author + date,
 * star rating on the right, body, and an optional partner response with a
 * brand left-rule.
 *
 * `actions` is an optional footer slot: the detail carousel injects the
 * own-review edit/delete island (Slice 2) into every card — the island decides
 * client-side whether to render, so the card itself adds no divider/wrapper.
 * The /reviews route passes nothing (R1: controls live on the detail top-5).
 */
export function ReviewCard({
  review,
  className,
  clamp = true,
  actions,
}: {
  review: PublicReview;
  className?: string;
  clamp?: boolean;
  actions?: ReactNode;
}) {
  return (
    <article
      className={cn(
        'flex flex-col gap-2.5 rounded-card bg-figma-bg-warm p-[18px]',
        className,
      )}
    >
      <header className='flex items-center gap-3'>
        <ReviewAvatar
          name={review.author.name}
          photo={avatarSource(review.author.avatar_url)}
        />
        <div className='min-w-0'>
          <div className='text-[15px] font-semibold text-foreground'>
            {review.author.name}
          </div>
          <time
            dateTime={review.created_at}
            className='text-caption-m text-[#9a9a9a]'
          >
            {formatDateRu(review.created_at)}
          </time>
          {review.is_edited ? (
            <span className='text-caption-m text-[#9a9a9a]'> · изменён</span>
          ) : null}
        </div>
        <div className='ml-auto'>
          <StarRating rating={review.rating} />
        </div>
      </header>

      {review.content ? (
        <p
          className={cn(
            'text-body-m leading-[1.55] text-[#3A3A3A]',
            clamp && 'line-clamp-6',
          )}
        >
          {review.content}
        </p>
      ) : null}

      {review.partner_response ? (
        <div className='flex flex-col gap-1 rounded-r-[10px] border-l-2 border-brand bg-background p-3'>
          <div className='text-caption-m font-semibold text-brand'>
            Ответ заведения
          </div>
          <p
            className={cn(
              'text-body-s leading-[1.5] text-[#3A3A3A]',
              clamp && 'line-clamp-3',
            )}
          >
            {review.partner_response}
          </p>
        </div>
      ) : null}

      {actions}
    </article>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div
      className='flex items-center gap-0.5'
      aria-label={`Оценка: ${rating} из 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={
            n <= rating
              ? 'size-3.5 fill-brand text-brand'
              : 'size-3.5 text-muted-foreground'
          }
          aria-hidden='true'
        />
      ))}
    </div>
  );
}
