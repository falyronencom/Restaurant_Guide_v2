import 'server-only';

import { authedFetch } from '@/lib/auth/session';

/*
 * Reviews — authenticated typed endpoint over POST /api/v1/reviews.
 *
 * Bearer-gated; user_id is derived server-side from the JWT and must NEVER be
 * sent in the payload. Mirrors endpoints/favorites.ts: a single authed write via
 * authedFetch, which throws ApiError(401, …, 'NO_SESSION') for an anonymous
 * caller with no backend round-trip.
 *
 * Casing (verified against backend validateCreateReview, reviewValidation.js:27 —
 * a mismatch is a SILENT 422):
 *   CREATE → POST /api/v1/reviews  body { establishmentId, rating, content }
 *     establishmentId: UUID (camelCase) · rating: int 1–5 · content: 1–1000 (trimmed)
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
