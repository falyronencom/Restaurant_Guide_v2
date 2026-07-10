'use server';

import { revalidatePath } from 'next/cache';

import {
  createReview,
  deleteReview,
  updateReview,
} from '@/lib/api/endpoints/reviews';
import { ApiError } from '@/lib/api/types';

/*
 * Review Server Actions (reviews-write Slice 1 create + Slice 2 edit/delete).
 * The state-changing writes are Server Actions for Next 16's built-in POST-only
 * + Origin/Host CSRF defense — same rationale as favorites/actions.ts and
 * auth/actions.ts (no Route Handler, no middleware). Fallback to a buffered
 * Route Handler ONLY if edge-503 recurs on write; favorites' single authed call
 * survived Railway edge, so Server Actions are expected fine here
 * (feedback_railway_edge_503).
 *
 * All three actions share the {ok} union, the 422-ARRAY field mapping, and the
 * LITERAL revalidatePath on success; they differ only in the per-code Russian
 * texts (edit/delete have ownership codes and can never hit 409/429 — the
 * duplicate check and the daily quota are create-only, Discovery §2/§4).
 */

export type ReviewActionResult =
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: Record<string, string>;
    };

export type CreateReviewResult = ReviewActionResult;

/**
 * Per-field Russian texts keyed by the backend validator's field names
 * (content / rating). The backend validator texts are English and never surface
 * in the UI — mirror of auth/actions.ts FIELD_TEXTS_RU for the review fields.
 */
const FIELD_TEXTS_RU: Record<string, string> = {
  content: 'Текст отзыва: от 1 до 1000 символов.',
  rating: 'Поставьте оценку от 1 до 5.',
};

const VALIDATION_SUMMARY_RU = 'Проверьте правильность заполнения полей.';

/**
 * Create a review. On success busts the ISR detail page so the new review is
 * visible on next render; returns a mapped `{ok:false, code, message,
 * fieldErrors?}` on any rejection (the modal renders per-field 422 + a summary
 * banner for 409/429/network).
 */
export async function createReviewAction(input: {
  establishmentId: string;
  rating: number;
  content: string;
  detailPath: string;
}): Promise<CreateReviewResult> {
  try {
    await createReview({
      establishmentId: input.establishmentId,
      rating: input.rating,
      content: input.content,
    });
  } catch (err) {
    return mapReviewError(err, messageForCreateCode);
  }

  // Literal path → invalidates EXACTLY this one detail page. A dynamic pattern
  // (`/[city]/[category]/[slug]`) would need type:'page' and would revalidate
  // ALL establishments (Discovery Q7). The /reviews route is force-dynamic and
  // needs no invalidation.
  revalidatePath(input.detailPath);
  return { ok: true };
}

/**
 * Update the user's own review (rating + content — the form always submits
 * both). Mirrors createReviewAction: literal revalidatePath on success only.
 * Ownership is authoritative server-side (403 UNAUTHORIZED_REVIEW_MODIFICATION);
 * the client check on the card is a UX affordance.
 */
export async function updateReviewAction(input: {
  reviewId: string;
  rating: number;
  content: string;
  detailPath: string;
}): Promise<ReviewActionResult> {
  try {
    await updateReview(input.reviewId, {
      rating: input.rating,
      content: input.content,
    });
  } catch (err) {
    return mapReviewError(err, messageForUpdateCode);
  }
  revalidatePath(input.detailPath);
  return { ok: true };
}

/**
 * Delete (soft) the user's own review. Terminal for this establishment: the
 * backend still finds the tombstone on a later create → 409 DUPLICATE_REVIEW
 * (R2 — the confirm dialog carries the warning). Success busts the literal
 * detail path so the card disappears and the recomputed aggregate re-renders.
 */
export async function deleteReviewAction(input: {
  reviewId: string;
  detailPath: string;
}): Promise<ReviewActionResult> {
  try {
    await deleteReview(input.reviewId);
  } catch (err) {
    return mapReviewError(err, messageForDeleteCode);
  }
  revalidatePath(input.detailPath);
  return { ok: true };
}

function mapReviewError(
  err: unknown,
  messageFor: (code: string | undefined, status: number) => string,
): ReviewActionResult {
  if (err instanceof ApiError) {
    if (err.errorCode === 'VALIDATION_ERROR') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: VALIDATION_SUMMARY_RU,
        fieldErrors: mapValidationDetails(err.details),
      };
    }
    return {
      ok: false,
      code: err.errorCode ?? `HTTP_${err.statusCode}`,
      message: messageFor(err.errorCode, err.statusCode),
    };
  }
  return {
    ok: false,
    code: 'NETWORK',
    message: 'Сеть недоступна. Попробуйте позже.',
  };
}

/**
 * The backend `validate` middleware (errorHandler.js:198) emits `details` as an
 * ARRAY `[{field, message, value}, …]` (express-validator `.array()`, wired at
 * reviewRoutes.js:60) — NOT a `{field: [messages]}` object. Only the `field` key
 * is trusted; the English validator message is replaced with the Russian
 * per-field text. Verified against the real wire (Phase 3.5).
 */
function mapValidationDetails(
  details: unknown,
): Record<string, string> | undefined {
  if (!Array.isArray(details)) return undefined;
  const fieldErrors: Record<string, string> = {};
  for (const entry of details) {
    const field =
      entry && typeof entry === 'object' && 'field' in entry
        ? String((entry as { field: unknown }).field)
        : undefined;
    if (field && field in FIELD_TEXTS_RU) {
      fieldErrors[field] = FIELD_TEXTS_RU[field];
    }
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

function messageForCreateCode(
  code: string | undefined,
  status: number,
): string {
  switch (code) {
    case 'DUPLICATE_REVIEW':
      // One-per-establishment. The CTA normally hides create when the user's
      // review is in the loaded set; this is the graceful fallback when it isn't
      // (own review beyond the top-5 — Discovery). Also reached after a delete:
      // deletion is terminal (R2), the tombstone still trips this 409.
      return 'Вы уже оставили отзыв на это заведение.';
    case 'RATE_LIMIT_EXCEEDED':
      // Backend emits RATE_LIMIT_EXCEEDED (NOT the mobile DAILY_QUOTA_EXCEEDED,
      // which is a latent mobile bug — Discovery).
      return 'Слишком часто, попробуйте позже.';
    case 'ESTABLISHMENT_NOT_FOUND':
      return 'Заведение не найдено.';
    case 'NO_SESSION':
      // The CTA gates on auth, so this should not be reached from the modal.
      return 'Войдите, чтобы оставить отзыв.';
    default:
      if (status === 429) return 'Слишком часто, попробуйте позже.';
      return 'Не удалось отправить отзыв. Попробуйте позже.';
  }
}

// Edit/delete cannot 409 or 429 (duplicate check and daily quota are
// create-only), so their maps carry the ownership/not-found codes instead.
function messageForUpdateCode(code: string | undefined): string {
  switch (code) {
    case 'UNAUTHORIZED_REVIEW_MODIFICATION':
      // Client-side ownership is an affordance; this is the authoritative 403.
      return 'Можно изменять только свой отзыв.';
    case 'REVIEW_NOT_FOUND':
      return 'Отзыв не найден. Обновите страницу.';
    case 'NO_SESSION':
      return 'Войдите, чтобы изменить отзыв.';
    default:
      return 'Не удалось сохранить изменения. Попробуйте позже.';
  }
}

function messageForDeleteCode(code: string | undefined): string {
  switch (code) {
    case 'UNAUTHORIZED_REVIEW_DELETION':
      return 'Можно удалять только свой отзыв.';
    case 'REVIEW_NOT_FOUND':
      // Covers an already-deleted review (stale page) — same backend code.
      return 'Отзыв не найден. Обновите страницу.';
    case 'NO_SESSION':
      return 'Войдите, чтобы удалить отзыв.';
    default:
      return 'Не удалось удалить отзыв. Попробуйте позже.';
  }
}
