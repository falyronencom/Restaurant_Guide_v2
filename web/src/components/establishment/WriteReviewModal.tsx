'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { createReviewAction, updateReviewAction } from '@/lib/reviews/actions';
import { cn } from '@/lib/utils';

/*
 * Write-review modal (reviews-write Slice 1 create + Slice 2 edit). Controlled
 * star + textarea state (never uncontrolled → immune to React 19's post-action
 * form reset, feedback_react19_form_reset; the char counter needs the value
 * anyway). Submit calls the Server Action directly (favorites pattern), NOT a
 * <form> useActionState — the field-error RENDERING mirrors LoginForm, the
 * MECHANISM mirrors favorites. Rendered on the design-system ui/dialog (base-ui).
 *
 * Edit mode = the same form parameterized, not a fork (Discovery §5): an
 * `editTarget` prop pre-fills the fields, retitles to «Редактировать отзыв» /
 * «Сохранить», and routes submit to updateReviewAction. Without it the Slice-1
 * create contract is byte-for-byte unchanged.
 */

const MAX_CONTENT = 1000;

export type ReviewEditTarget = {
  reviewId: string;
  rating: number;
  content: string;
};

export function WriteReviewModal({
  open,
  onOpenChange,
  establishmentName,
  establishmentId,
  detailPath,
  onSuccess,
  editTarget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  establishmentName: string;
  establishmentId: string;
  detailPath: string;
  onSuccess: () => void;
  editTarget?: ReviewEditTarget;
}) {
  const [rating, setRating] = useState(editTarget?.rating ?? 0);
  const [hover, setHover] = useState<number | null>(null);
  const [content, setContent] = useState(editTarget?.content ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{
    message?: string;
    fieldErrors?: Record<string, string>;
  } | null>(null);

  // Fresh form on every open. The component stays mounted across open/close
  // (only the dialog portal content mounts/unmounts), so state would otherwise
  // leak from a previous session. Guarded render-phase reset (React's "adjusting
  // state when a prop changes" — same pattern as FavoritesProvider) instead of a
  // setState-in-effect, which cascades renders.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      // Edit re-seeds from the target so an abandoned session's typing never
      // leaks into the next open (and a refreshed prop wins after a save).
      setRating(editTarget?.rating ?? 0);
      setHover(null);
      setContent(editTarget?.content ?? '');
      setPending(false);
      setError(null);
    }
  }

  const trimmed = content.trim();

  async function handleSubmit() {
    // Client-side guard mirrors the backend validator (rating 1–5 int, content
    // 1–1000 trimmed) so the common cases never round-trip; the server mapping
    // is the backstop for anything that slips through.
    const fieldErrors: Record<string, string> = {};
    if (rating < 1 || rating > 5) {
      fieldErrors.rating = 'Поставьте оценку от 1 до 5.';
    }
    if (trimmed.length < 1) {
      fieldErrors.content = 'Напишите текст отзыва.';
    } else if (content.length > MAX_CONTENT) {
      fieldErrors.content = `Не более ${MAX_CONTENT} символов.`;
    }
    if (Object.keys(fieldErrors).length > 0) {
      setError({ fieldErrors });
      return;
    }

    setPending(true);
    setError(null);
    const result = editTarget
      ? await updateReviewAction({
          reviewId: editTarget.reviewId,
          rating,
          content: trimmed,
          detailPath,
        })
      : await createReviewAction({
          establishmentId,
          rating,
          content: trimmed,
          detailPath,
        });
    setPending(false);

    if (result.ok) {
      onSuccess();
    } else {
      setError({ message: result.message, fieldErrors: result.fieldErrors });
    }
  }

  const ratingError = error?.fieldErrors?.rating;
  const contentError = error?.fieldErrors?.content;
  const summaryError = error?.message && !error.fieldErrors ? error.message : null;
  const litUpTo = hover ?? rating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {editTarget ? 'Редактировать отзыв' : 'Ваш отзыв'}
          </DialogTitle>
          <DialogDescription>
            Заведение: «{establishmentName}»
          </DialogDescription>
        </DialogHeader>

        {/* Rating — single-select toggle buttons (one pressed at a time). */}
        <div className='flex flex-col gap-1.5'>
          <span className='text-label-m text-foreground'>Оценка</span>
          <div
            role='group'
            aria-label='Оценка'
            className='flex items-center gap-1.5'
            onMouseLeave={() => setHover(null)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type='button'
                aria-pressed={rating === n}
                aria-label={`Оценка ${n} из 5`}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                className='rounded-sm p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
              >
                <Star
                  className={cn(
                    'size-7 transition-colors',
                    n <= litUpTo
                      ? 'fill-brand text-brand'
                      : 'text-figma-text-grey',
                  )}
                  aria-hidden='true'
                />
              </button>
            ))}
          </div>
          {ratingError ? (
            <p className='text-caption-l text-destructive'>{ratingError}</p>
          ) : null}
        </div>

        {/* Content */}
        <div className='flex flex-col gap-1.5'>
          <label
            htmlFor='review-content'
            className='text-label-m text-foreground'
          >
            Отзыв
          </label>
          <Textarea
            id='review-content'
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={MAX_CONTENT}
            rows={4}
            placeholder='Расскажите, что понравилось…'
            aria-invalid={contentError ? true : undefined}
            aria-describedby={contentError ? 'review-content-error' : undefined}
          />
          <div className='flex items-center justify-between gap-2'>
            {contentError ? (
              <p
                id='review-content-error'
                className='text-caption-l text-destructive'
              >
                {contentError}
              </p>
            ) : (
              <span aria-hidden='true' />
            )}
            <span className='shrink-0 text-caption-m text-figma-text-grey'>
              {content.length} / {MAX_CONTENT}
            </span>
          </div>
        </div>

        {summaryError ? (
          <p aria-live='polite' className='text-caption-l text-destructive'>
            {summaryError}
          </p>
        ) : null}

        <div className='flex justify-end gap-2.5'>
          <Button
            type='button'
            variant='outline'
            size='cta'
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Отмена
          </Button>
          <Button
            type='button'
            size='cta'
            onClick={handleSubmit}
            disabled={pending}
            className='bg-brand text-text-on-primary hover:bg-brand/90'
          >
            {editTarget
              ? pending
                ? 'Сохраняем…'
                : 'Сохранить'
              : pending
                ? 'Публикуем…'
                : 'Опубликовать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
