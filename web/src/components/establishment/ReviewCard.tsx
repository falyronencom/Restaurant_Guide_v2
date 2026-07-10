import Image from 'next/image';
import { Star } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PublicReview } from '@/lib/api/types';
import { formatDateRu } from '@/lib/establishment-helpers';
import { cn } from '@/lib/utils';

/**
 * ReviewCard — Server Component. Shared by the detail-page ReviewCarousel
 * (compact, clamped) and the /reviews route (full). Warm-beige card: colored
 * initial avatar + author + date, star rating on the right, body, and an
 * optional partner response with a brand left-rule.
 *
 * `actions` is an optional footer slot: the detail carousel injects the
 * own-review edit/delete island (Slice 2) into every card — the island decides
 * client-side whether to render, so the card itself adds no divider/wrapper.
 * The /reviews route passes nothing (R1: controls live on the detail top-5).
 */

// Stable avatar tint by author name (design uses a small varied palette).
const AVATAR_COLORS = [
  'bg-brand',
  'bg-success-status',
  'bg-figma-navy',
  'bg-[#A07A52]',
] as const;

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

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
        'flex flex-col gap-2.5 rounded-[18px] bg-figma-bg-warm p-[18px]',
        className,
      )}
    >
      <header className='flex items-center gap-3'>
        <div
          className={cn(
            'relative flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full font-display text-[16px] font-bold text-text-on-primary',
            avatarColor(review.author.name),
          )}
        >
          {review.author.avatar_url ? (
            <Image
              src={review.author.avatar_url}
              alt={review.author.name}
              fill
              sizes='42px'
              className='object-cover'
            />
          ) : (
            review.author.name.charAt(0).toUpperCase()
          )}
        </div>
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
