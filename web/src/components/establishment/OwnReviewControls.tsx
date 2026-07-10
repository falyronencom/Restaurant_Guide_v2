'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import type { PublicReview } from '@/lib/api/types';

import { DeleteReviewDialog } from './DeleteReviewDialog';
import { WriteReviewModal } from './WriteReviewModal';

/*
 * Own-review edit/delete controls (reviews-write Slice 2) — a client island in
 * the RSC ReviewCard footer slot. The carousel injects it into EVERY card;
 * ownership resolves client-side (the ISR page reads no cookies — auth is
 * client-only, mirroring WriteReviewCta) and everything below returns null
 * unless the card is the session user's own review, so foreign cards render no
 * footer at all (the divider lives here, not in ReviewCard).
 *
 * Layout per VISUAL_SPEC_slice2 §1: divider, then outline «Редактировать» +
 * destructive-outline «Удалить». Edit reuses WriteReviewModal pre-filled via
 * editTarget; delete opens the terminality confirm. Ownership here is a UX
 * affordance only — the backend service 403s are authoritative.
 *
 * R1: only a review present in the loaded top-5 gets controls; an older own
 * review beyond it keeps the Slice-1 fallback (create CTA → graceful 409).
 */
export function OwnReviewControls({
  review,
  establishmentId,
  establishmentName,
  detailPath,
}: {
  review: PublicReview;
  establishmentId: string;
  establishmentName: string;
  detailPath: string;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!user || user.id !== review.author.id) return null;

  return (
    <div className='flex items-center gap-2 border-t border-border pt-2.5'>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => setEditOpen(true)}
      >
        <Pencil aria-hidden='true' />
        Редактировать
      </Button>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive'
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 aria-hidden='true' />
        Удалить
      </Button>

      <WriteReviewModal
        open={editOpen}
        onOpenChange={setEditOpen}
        establishmentId={establishmentId}
        establishmentName={establishmentName}
        detailPath={detailPath}
        editTarget={{
          reviewId: review.id,
          rating: review.rating,
          content: review.content ?? '',
        }}
        onSuccess={() => {
          setEditOpen(false);
          router.refresh();
        }}
      />
      <DeleteReviewDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        reviewId={review.id}
        detailPath={detailPath}
        onSuccess={() => {
          setDeleteOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
