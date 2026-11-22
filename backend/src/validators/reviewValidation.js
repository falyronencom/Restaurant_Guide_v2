/**
 * Review Validation Rules
 * 
 * This module defines express-validator validation chains for review endpoints.
 * Validation middleware executes before controllers, ensuring only valid data
 * reaches business logic.
 * 
 * Architecture note: Validation serves as the first line of defense against invalid
 * input. By catching problems early with clear error messages, we prevent wasted
 * processing and provide better user experience than database constraint violations.
 */

import { body, param, query } from 'express-validator';
import { containsProfanity } from '../utils/profanity.js';

/**
 * The refusal of a review or an owner's reply with мат (decision of the
 * Coordinator, 17.10.2026, В8): the text is not saved, the person reads why.
 * Russian, unlike the field texts around it: no client has it in a table, and
 * the app and the site show a Russian validator message as is.
 */
export const PROFANE_TEXT_MESSAGE = 'Текст содержит нецензурные выражения — уберите их, пожалуйста';

const withoutProfanity = (value) => {
  if (containsProfanity(value)) throw new Error(PROFANE_TEXT_MESSAGE);
  return true;
};

/**
 * The review's text, when there is one: at most 1000 characters after
 * trimming, without мат. Absent or null passes untouched — a review may be a
 * rating alone (decision of the Coordinator 20.11.2026, thread «Отзыв без
 * текста»); an empty string or one of spaces trims to '' and passes too. The
 * service stores every one of them as NULL (reviewService.storedReviewText),
 * and the мат check has nothing to read in them (containsProfanity('') is
 * false). The bound is the validator's isLength — the one that counts an
 * emoji with its selector as one character (tests: «length limits count
 * invisible variation selectors»).
 */
const optionalReviewText = () => body('content')
  .optional({ values: 'null' })
  .trim()
  .isLength({ max: 1000 })
  .withMessage('Review content must be at most 1000 characters')
  .bail()
  .custom(withoutProfanity);

/**
 * «Только с текстом» of the review lists (`with_text=true`): the card shows
 * its first reviews with a text only (decision В1 = А, 20.11.2026). Only the
 * strings 'true' and 'false' — what the controllers read; anything else, a
 * repeated parameter included, is refused like the lists' other parameters.
 * Without it the list is as it was, for the builds that never send it.
 */
const withTextQuery = () => query('with_text')
  .optional()
  .custom((value) => value === 'true' || value === 'false')
  .withMessage('with_text must be true or false');

/**
 * Validation for creating a new review
 *
 * POST /api/v1/reviews
 *
 * These rules enforce the directive's specifications:
 * - establishment_id must be a valid UUID
 * - rating must be an integer between 1 and 5 inclusive
 * - content is optional; when given, at most 1000 characters after trimming
 *   (optionalReviewText above)
 *
 * The user_id comes from authenticated context, not request body, so we don't validate it here.
 */
export const validateCreateReview = [
  body('establishmentId')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  body('rating')
    .notEmpty()
    .withMessage('Rating is required')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),

  optionalReviewText(),
];

/**
 * Validation for getting a specific review by ID
 * 
 * GET /api/v1/reviews/:id
 * 
 * The only input is the review ID from the URL path parameter.
 * We validate it's a properly formatted UUID.
 */
export const validateGetReview = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),
];

/**
 * Validation for getting establishment reviews
 * 
 * GET /api/v1/establishments/:id/reviews
 * 
 * Path parameter: establishment ID (UUID)
 * Query parameters: page, limit, sort, date_from, date_to, with_text (all
 * optional with defaults)
 *
 * We validate ranges and enums to prevent malicious or nonsensical values.
 * For example, page 0 or limit 9999 should be rejected before reaching business logic.
 */
export const validateGetEstablishmentReviews = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),

  query('sort')
    .optional()
    .isIn(['newest', 'highest', 'lowest'])
    .withMessage('Sort must be one of: newest, highest, lowest'),

  query('date_from')
    .optional()
    .isISO8601()
    .withMessage('date_from must be a valid ISO 8601 date'),

  query('date_to')
    .optional()
    .isISO8601()
    .withMessage('date_to must be a valid ISO 8601 date'),

  withTextQuery(),
];

/**
 * Validation for the site's review list
 *
 * GET /api/v1/public/establishments/by-slug/:slug/reviews
 *
 * `page` and `limit` of this path are clamped by its controller, not refused
 * (publicController.getPublicReviews); `with_text` is checked as on
 * GET /establishments/:id/reviews, so the two lists answer one value alike.
 */
export const validateGetPublicReviews = [
  withTextQuery(),
];

/**
 * Validation for getting user reviews
 * 
 * GET /api/v1/users/:id/reviews
 * 
 * Path parameter: user ID (UUID)
 * Query parameters: page, limit (both optional with defaults)
 * 
 * Similar to establishment reviews but without sort parameter since user reviews
 * always sort by newest first (most recent activity).
 */
export const validateGetUserReviews = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('User ID is required')
    .isUUID()
    .withMessage('User ID must be a valid UUID'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
];

/**
 * Validation for updating a review
 * 
 * PUT /api/v1/reviews/:id
 * 
 * Path parameter: review ID (UUID)
 * Body: rating and/or content (at least one must be provided)
 * 
 * This is a partial update endpoint - users can update just rating, just content,
 * or both. We validate that at least one field is present and that provided fields
 * meet the same requirements as creation.
 *
 * An empty content or null is a change, not a missing field: it erases the
 * text, and the review stays a rating alone (the site's edit form sends both
 * fields, an erased text as ''). Only an absent key means «leave the text as
 * it is».
 *
 * The service layer handles authorization (ensuring user is review author).
 */
export const validateUpdateReview = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),

  // Rating is optional but if provided must be valid
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),

  // Content is optional; when given — the creation's rule, and '' or null
  // erase the text
  optionalReviewText(),

  // Custom validation to ensure at least one field is being updated: a key
  // that is there counts, whatever its value — content '' or null included
  body()
    .custom((value) => {
      const hasRating = value.rating !== undefined;
      const hasContent = value.content !== undefined;
      if (!hasRating && !hasContent) {
        throw new Error('At least one field (rating or content) must be provided for update');
      }
      return true;
    }),
];

/**
 * Validation for deleting a review
 * 
 * DELETE /api/v1/reviews/:id
 * 
 * The only input is the review ID from the URL path parameter.
 * The service layer handles authorization (ensuring user is review author).
 */
export const validateDeleteReview = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),
];

/**
 * No validation needed for quota endpoint
 * 
 * GET /api/v1/reviews/quota
 * 
 * This endpoint takes no parameters - it returns quota information for the
 * authenticated user based on their JWT token. No validation rules needed.
 */
export const validateGetQuota = [];

/**
 * Validation for partner response creation/update
 * 
 * POST /api/v1/reviews/:id/response
 */
export const validatePartnerResponse = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),

  body('response')
    .trim()
    .notEmpty()
    .withMessage('Response text is required')
    .isLength({ min: 10, max: 1000 })
    .withMessage('Response text must be between 10 and 1000 characters')
    .bail()
    .custom(withoutProfanity),
];

/**
 * Validation for deleting partner response
 * 
 * DELETE /api/v1/reviews/:id/response
 */
export const validateDeletePartnerResponse = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),
];

