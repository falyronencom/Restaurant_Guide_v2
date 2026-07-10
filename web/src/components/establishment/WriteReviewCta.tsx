'use client';

import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import type { PublicReview } from '@/lib/api/types';

import { WriteReviewModal } from './WriteReviewModal';

/*
 * Write-review CTA — client island in the ReviewCarousel header. The RSC parent
 * passes public review data; auth state is client-only (mirrors
 * FavoritesProvider/FavoriteButton — the ISR detail page reads no cookies).
 *
 * Ownership-aware per the visual spec:
 *   - own review already in the loaded set (author.id === session user id) →
 *     «Ваш отзыв» pill (edit/delete = Slice 2); their card is already listed below.
 *   - anonymous → tap opens Google One Tap (requestLogin, mirror FavoriteButton),
 *     no modal.
 *   - authenticated without a review here → opens the write modal.
 * A review by the user beyond the loaded top-5 is not detectable client-side; the
 * create attempt then falls back to a graceful 409 DUPLICATE_REVIEW (Discovery).
 */
export function WriteReviewCta({
  establishmentId,
  establishmentName,
  detailPath,
  reviews,
}: {
  establishmentId: string;
  establishmentName: string;
  detailPath: string;
  reviews: PublicReview[];
}) {
  const { user, isAuthenticated, requestLogin } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const hasOwnReview = user
    ? reviews.some((review) => review.author.id === user.id)
    : false;

  if (hasOwnReview) {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-m border border-border px-3 py-1.5 text-body-m font-medium text-muted-foreground'>
        Ваш отзыв
      </span>
    );
  }

  return (
    <>
      <Button
        type='button'
        onClick={() => {
          if (!isAuthenticated) {
            requestLogin();
            return;
          }
          setOpen(true);
        }}
        className='bg-brand text-text-on-primary hover:bg-brand/90'
      >
        <Pencil className='size-4' aria-hidden='true' />
        Оставить отзыв
      </Button>
      <WriteReviewModal
        open={open}
        onOpenChange={setOpen}
        establishmentId={establishmentId}
        establishmentName={establishmentName}
        detailPath={detailPath}
        onSuccess={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
