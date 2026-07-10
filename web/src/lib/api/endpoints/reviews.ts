import 'server-only';

import { authedFetch } from '@/lib/auth/session';

/*
 * Reviews — authenticated typed endpoints over /api/v1/reviews*.
 *
 * Bearer-gated; user_id is derived server-side from the JWT and must NEVER be
 * sent in a payload. Mirrors endpoints/favorites.ts: authed writes via
 * authedFetch, which throws ApiError(401, …, 'NO_SESSION') for an anonymous
 * caller with no backend round-trip.
 *
 * Casing (verified against backend validators, reviewValidation.js —
 * a mismatch is a SILENT 422):
 *   CREATE → POST /api/v1/reviews  body { establishmentId, rating, content }
 *     establishmentId: UUID (camelCase) · rating: int 1–5 · content: 1–1000 (trimmed)
 *   UPDATE → PUT /api/v1/reviews/:id  body { rating?, content? } (≥1 required)
 *   DELETE → DELETE /api/v1/reviews/:id  (path param only, no body)
 *
 * Ownership of :id is enforced by the backend SERVICE (no middleware) — 403
 * UNAUTHORIZED_REVIEW_MODIFICATION / UNAUTHORIZED_REVIEW_DELETION.
 */

export type CreateReviewInput = {
  establishmentId: string;
  rating: number;
  content: string;
};

/**
 * Create a review for the authenticated user. Resolves on 201; throws ApiError
 * on any backend rejection (409 DUPLICATE_REVIEW, 422 VALIDATION_ERROR, 429
 * RATE_LIMIT_EXCEEDED, 404 ESTABLISHMENT_NOT_FOUND, 401 NO_SESSION).
 *
 * The created row is intentionally NOT consumed: the raw create response is
 * `findReviewById` (leaks user_id/author_email — Discovery Q1), not toPublicReview.
 * The caller revalidates the ISR detail page + router.refresh() to re-render the
 * new review from the public projection instead.
 */
export async function createReview(input: CreateReviewInput): Promise<void> {
  await authedFetch('/api/v1/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // camelCase `establishmentId` — backend validator rejects snake_case here.
    body: JSON.stringify({
      establishmentId: input.establishmentId,
      rating: input.rating,
      content: input.content,
    }),
  });
}

export type UpdateReviewInput = {
  rating?: number;
  content?: string;
};

/**
 * Update the authenticated user's own review. Resolves on 200; throws ApiError
 * on rejection (422 VALIDATION_ERROR, 403 UNAUTHORIZED_REVIEW_MODIFICATION,
 * 404 REVIEW_NOT_FOUND, 401 NO_SESSION). Edit is NOT rate-limited — the quota
 * is create-only, 429 is unreachable here (Discovery §4).
 *
 * Like create, the success body is the raw leaky `findReviewById` row —
 * intentionally ignored; the caller revalidates + refreshes to re-render from
 * the public projection.
 */
export async function updateReview(
  reviewId: string,
  input: UpdateReviewInput,
): Promise<void> {
  await authedFetch(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // JSON.stringify drops undefined keys — only the provided fields reach the
    // backend validator (which requires ≥1 of rating/content).
    body: JSON.stringify({ rating: input.rating, content: input.content }),
  });
}

/**
 * Soft-delete the authenticated user's own review. Resolves on 200 (body is a
 * message only — no review object); throws ApiError on rejection
 * (403 UNAUTHORIZED_REVIEW_DELETION, 404 REVIEW_NOT_FOUND — including an
 * already-deleted row, 401 NO_SESSION). Deletion is TERMINAL for this
 * establishment: the service still finds the tombstone on a later create and
 * throws 409 DUPLICATE_REVIEW (R2 — the confirm dialog carries the warning).
 */
export async function deleteReview(reviewId: string): Promise<void> {
  await authedFetch(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, {
    method: 'DELETE',
  });
}
