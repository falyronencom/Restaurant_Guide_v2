/**
 * Review Public Projection
 *
 * Pure function that transforms raw review DB row into public-safe shape.
 * Excludes admin/moderation flags and internal identifiers; preserves the
 * partner response (partner_response text is public, but partner_responder_id
 * is hidden as it leaks the partner-side user UUID).
 *
 * Excluded fields:
 *   - is_visible, is_deleted (filtering flags, never exposed)
 *   - partner_responder_id (leaks partner user UUID)
 *   - user_id (replaced by author.id which is the same value, but the
 *     wrapper shape is the public contract)
 */

/**
 * Convert raw review row (from reviewService.getEstablishmentReviews shape)
 * to public projection.
 *
 * Accepts either:
 *   - Already-formatted review with `author: { id, name, avatar_url }`
 *     (output of reviewService.getEstablishmentReviews)
 *   - Raw DB row with `user_id`, `author_name`, `author_avatar`
 *
 * @param {Object} review - Review row or formatted review object
 * @returns {Object} Public projection
 */
export const toPublicReview = (review) => {
  if (!review) return null;

  // Build author wrapper from either pre-formatted or raw row
  let author;
  if (review.author && typeof review.author === 'object') {
    author = {
      id: review.author.id,
      name: review.author.name,
      avatar_url: review.author.avatar_url,
    };
  } else {
    author = {
      id: review.user_id,
      name: review.author_name,
      avatar_url: review.author_avatar,
    };
  }

  return {
    id: review.id,
    establishment_id: review.establishment_id,
    rating: review.rating,
    content: review.content,
    partner_response: review.partner_response || null,
    partner_response_at: review.partner_response_at || null,
    is_edited: !!review.is_edited,
    created_at: review.created_at,
    updated_at: review.updated_at,
    author,
  };
};

/**
 * Convert a user-review row (from reviewService.getUserReviews shape) to
 * public projection. Mirrors toPublicReview but preserves the establishment
 * wrapper (rather than author) — the consumer already knows the user since
 * userId is the path parameter.
 *
 * Excludes the same sensitive fields as toPublicReview:
 *   - partner_responder_id (leaks partner user UUID)
 *   - is_visible, is_deleted (filtering flags)
 *
 * @param {Object} review - Pre-formatted review with `establishment` wrapper
 * @returns {Object} Public projection
 */
export const toPublicUserReview = (review) => {
  if (!review) return null;

  return {
    id: review.id,
    establishment_id: review.establishment_id,
    rating: review.rating,
    content: review.content,
    partner_response: review.partner_response || null,
    partner_response_at: review.partner_response_at || null,
    is_edited: !!review.is_edited,
    created_at: review.created_at,
    updated_at: review.updated_at,
    establishment: review.establishment || null,
  };
};
