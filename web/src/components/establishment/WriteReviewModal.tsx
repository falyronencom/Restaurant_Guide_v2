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

import { VerifyEmailToReview } from './VerifyEmailToReview';

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
 *
 * The text is optional (thread «Отзыв без текста», В6): a rating alone is a
 * review. Create without text sends no `content` key; an edit with the text
 * erased sends `content: ''`, which the server reads as «стереть текст» (В5).
 *
 * The server's refusal of a new review from an address not confirmed
 * (EMAIL_NOT_VERIFIED) shows the В9 words with «Отправить код» in place of
 * the summary error (VerifyEmailToReview); the form stays as typed.
 */

const MAX_CONTENT = 1000;

const CONTENT_HINT = 'Текст можно не писать: достаточно оценки';

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
    code?: string;
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
    // optional, up to 1000 trimmed) so the common cases never round-trip; the
    // server mapping is the backstop for anything that slips through.
    const fieldErrors: Record<string, string> = {};
    if (rating < 1 || rating > 5) {
      fieldErrors.rating = 'Поставьте оценку от 1 до 5.';
    }
    if (content.length > MAX_CONTENT) {
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
          // '' when the text was erased — the review keeps only its rating.
          content: trimmed,
          detailPath,
        })
      : await createReviewAction({
          establishmentId,
          rating,
          // No text → no `content` key: a review of one rating.
          ...(trimmed ? { content: trimmed } : {}),
          detailPath,
        });
    setPending(false);

    if (result.ok) {
      onSuccess();
    } else {
      setError({
        code: result.code,
        message: result.message,
        fieldErrors: result.fieldErrors,
      });
    }
  }

  const ratingError = error?.fieldErrors?.rating;
  const contentError = error?.fieldErrors?.content;
  const emailGateText =
    error?.code === 'EMAIL_NOT_VERIFIED' ? (error.message ?? null) : null;
  const summaryError =
    error?.message && !error.fieldErrors && !emailGateText ? error.message : null;
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

        {/* Content — optional (В6). The hint under the field is always
            there and gives way to the field's error, as the password hint of
            RegisterForm does. */}
        <div className='flex flex-col gap-1.5'>
          <label
            htmlFor='review-content'
            className='text-label-m text-foreground'
          >
            Отзыв (необязательно)
          </label>
          <Textarea
            id='review-content'
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={MAX_CONTENT}
            rows={4}
            placeholder='Расскажите, что понравилось…'
            aria-invalid={contentError ? true : undefined}
            aria-describedby='review-content-hint'
          />
          <div className='flex items-start justify-between gap-2'>
            <p
              id='review-content-hint'
              className={
                contentError
                  ? 'text-caption-l text-destructive'
                  : 'text-caption-l text-figma-text-dark'
              }
            >
              {contentError ?? CONTENT_HINT}
            </p>
            <span className='shrink-0 text-caption-m text-figma-text-grey'>
              {content.length} / {MAX_CONTENT}
            </span>
          </div>
        </div>

        {emailGateText ? (
          <VerifyEmailToReview
            text={emailGateText}
            detailPath={detailPath}
            // Confirmed elsewhere since: the refusal is stale — send again.
            onAlreadyVerified={() => setError(null)}
          />
        ) : null}

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
