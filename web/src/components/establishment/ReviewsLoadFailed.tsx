'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { PublicReview } from '@/lib/api/types';
import {
  reloadReviewsAction,
  type ReloadReviewsResult,
} from '@/lib/reviews/actions';

import { ReviewCarousel } from './ReviewCarousel';

/**
 * ReviewsLoadFailed — client island in place of the ReviewCarousel when the
 * detail page could not load its reviews (сверка находок тестировщика с
 * сайтом, 18.10, Х5 / Х23).
 *
 * Before: the page swallowed the failure into an empty list, so the visitor
 * read «Пока нет отзывов. Будьте первым…» about a place that has reviews, and
 * the ISR page kept that for up to an hour. Now the island loads the reviews
 * itself on mount (reloadReviewsAction — which also drops the cached failed
 * page), renders the regular carousel once they arrive, and says plainly that
 * the reviews did not load — with «Повторить» — if that fails too. It never
 * says «нет отзывов»: whether there are any is exactly what it does not know.
 */
type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; reviews: PublicReview[]; total: number };

export function ReviewsLoadFailed({
  slug,
  averageRating,
  reviewsHref,
  establishmentId,
  establishmentName,
  detailPath,
}: {
  slug: string;
  averageRating: number | null;
  reviewsHref?: string;
  establishmentId: string;
  establishmentName: string;
  detailPath: string;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Bumped by «Повторить»: each value is one more load attempt.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    reloadReviewsAction({ slug, detailPath })
      // The action itself unreachable (network) — same as a failed fetch.
      .catch((): ReloadReviewsResult => ({ ok: false }))
      .then((result) => {
        if (cancelled) return;
        setState(
          result.ok
            ? { status: 'loaded', reviews: result.reviews, total: result.total }
            : { status: 'failed' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug, detailPath, attempt]);

  if (state.status === 'loaded') {
    return (
      <ReviewCarousel
        reviews={state.reviews}
        totalCount={state.total}
        averageRating={averageRating}
        reviewsHref={reviewsHref}
        establishmentId={establishmentId}
        establishmentName={establishmentName}
        detailPath={detailPath}
      />
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <h2 className='font-display text-[20px] font-semibold'>Отзывы</h2>
      {state.status === 'loading' ? (
        <p
          role='status'
          className='rounded-card bg-figma-bg-warm p-l text-body-m text-muted-foreground'
        >
          Загружаем отзывы…
        </p>
      ) : (
        <div
          role='alert'
          className='flex flex-wrap items-center justify-between gap-m rounded-card bg-figma-bg-warm p-l'
        >
          <p className='text-body-m text-foreground'>
            Не удалось загрузить отзывы.
          </p>
          <Button
            variant='outline'
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Повторить
          </Button>
        </div>
      )}
    </div>
  );
}
