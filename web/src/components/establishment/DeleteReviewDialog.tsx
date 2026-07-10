'use client';

import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deleteReviewAction } from '@/lib/reviews/actions';

/*
 * Delete-review confirm dialog (reviews-write Slice 2). Mirrors the cabinet's
 * DeleteEstablishmentButton confirm idiom (DialogFooter bar, destructive
 * confirm, no dismiss mid-delete) but is controlled from the card's
 * OwnReviewControls rather than a DialogTrigger.
 *
 * The terminality warning is load-bearing copy (R2): delete is SOFT on the
 * backend, but the service still finds the tombstone on a later create and
 * throws 409 DUPLICATE_REVIEW — a user who deletes cannot review this
 * establishment again. The backend stays untouched; the dialog warns instead.
 */
export function DeleteReviewDialog({
  open,
  onOpenChange,
  reviewId,
  detailPath,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewId: string;
  detailPath: string;
  onSuccess: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guarded render-phase reset (same pattern as WriteReviewModal) — the dialog
  // stays mounted across open/close, so a previous attempt's error would leak
  // into the next open.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPending(false);
      setError(null);
    }
  }

  async function handleConfirm() {
    setPending(true);
    setError(null);
    const result = await deleteReviewAction({ reviewId, detailPath });
    if (result.ok) {
      onSuccess();
    } else {
      setPending(false);
      setError(result.message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return; // don't dismiss mid-delete
        onOpenChange(next);
      }}
    >
      {/* No close-X: the mock draws none, and the default X rides the base-ui
          Close path that is inert for controlled dialogs (see footer comment) —
          it would be a dead control on a destructive confirm. */}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Удалить отзыв?</DialogTitle>
        </DialogHeader>

        {/* Terminality warning — load-bearing copy (R2, VISUAL_SPEC_slice2). */}
        <div className='flex items-start gap-2 rounded-m border border-destructive/35 bg-destructive/10 p-3'>
          <TriangleAlert
            className='mt-0.5 size-4 shrink-0 text-destructive'
            aria-hidden='true'
          />
          <p className='text-body-s leading-normal text-destructive'>
            После удаления вы не сможете оставить новый отзыв на это заведение.
          </p>
        </div>

        {error ? (
          <p aria-live='polite' className='text-caption-l text-destructive'>
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {/* Direct onClick, NOT base-ui DialogClose: the Close/Esc dismiss
              path is inert for controlled dialogs in the real browser (verified
              live — trusted click lands on the button, dialog stays open;
              jsdom doesn't catch it). Mirrors WriteReviewModal's «Отмена». */}
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Отмена
          </Button>
          <Button
            type='button'
            variant='destructive'
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? 'Удаляем…' : 'Удалить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
