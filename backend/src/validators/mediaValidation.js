/**
 * Media Validation Rules
 * 
 * This module defines express-validator validation chains for media management
 * endpoints. Validation middleware executes before controllers, ensuring only
 * valid data reaches business logic.
 * 
 * Architecture note: Validation serves multiple purposes:
 * 1. Security - Prevents malformed data from reaching database and external services
 * 2. User experience - Provides clear error messages for invalid input
 * 3. Performance - Rejects bad requests early without wasting resources
 * 4. Data integrity - Ensures consistent data formats across the system
 * 
 * Note on file uploads: File validation (type, size) is handled by multer
 * middleware and business logic in the service layer. This validation focuses
 * on metadata fields (type, caption, is_primary).
 *
 * The card id in the URL is checked by the route before anything else
 * (routes/v1/mediaRoutes.js requireCanonicalCardId): only the id as the
 * database writes it — the cloud folder is named after it. The field texts are
 * the partner's (MEDIA_REFUSALS, from 20.10.2026; English before) and the
 * routes answer with validatePersonText: the first of them is the summary.
 */

import { body, param, query } from 'express-validator';
import { fitsVarchar } from '../utils/textLength.js';
import { MEDIA_REFUSALS } from '../constants/partnerSectionRefusals.js';

/**
 * The longest caption establishment_media.caption holds — varchar(255),
 * counted as the database counts it (utils/textLength.js). isLength skips
 * the variation selectors U+FE0E/U+FE0F: 255 × «❤️» passed it as 255 and
 * reached the database as 510 characters — 22001, a 500 (review of PR #86,
 * finding 2). A caption is text: after trim() it is a string, or an array
 * when the field came twice in a form (or as an array in JSON) — which pg
 * stored as the literal {"a","b"}, a 500 when longer than the column. An
 * array is refused as well (review round 2 of 19.10.2026). The refusal and
 * its text are the same as before.
 */
const CAPTION_MAX_CHARS = 255;
const captionFits = fitsVarchar(CAPTION_MAX_CHARS);

/**
 * Valid media type values
 */
const VALID_MEDIA_TYPES = ['interior', 'exterior', 'menu', 'dishes'];

/**
 * Validation for uploading media
 * 
 * POST /api/v1/partner/establishments/:id/media
 * 
 * Required:
 * - id: the card id, as the database writes it (path parameter; checked
 *   by the route, routes/v1/mediaRoutes.js)
 * - type: Valid media type ('interior', 'exterior', 'menu', 'dishes')
 * - file: Image file (handled by multer, not validated here)
 * 
 * Optional:
 * - caption: Max 255 characters
 * - is_primary: Boolean
 */
export const validateUpload = [
  // Media type validation
  body('type')
    .trim()
    .notEmpty()
    .withMessage(MEDIA_REFUSALS.uploadFormInvalid)
    .isIn(VALID_MEDIA_TYPES)
    .withMessage(MEDIA_REFUSALS.uploadFormInvalid),

  // Caption validation (optional)
  body('caption')
    .optional()
    .trim()
    .custom(captionFits)
    .withMessage(MEDIA_REFUSALS.captionTooLong),

  // is_primary validation (optional, defaults to false)
  body('is_primary')
    .optional()
    .isBoolean()
    .withMessage(MEDIA_REFUSALS.uploadFormInvalid)
    .toBoolean(),
];

/**
 * Validation for getting media list
 * 
 * GET /api/v1/partner/establishments/:id/media
 * 
 * Required:
 * - id: the card id, as the database writes it (path parameter; checked
 *   by the route, routes/v1/mediaRoutes.js)
 * 
 * Optional:
 * - type: Valid media type for filtering
 */
export const validateGetMedia = [
  // Type query parameter validation (optional filter)
  query('type')
    .optional()
    .isIn(VALID_MEDIA_TYPES)
    .withMessage(MEDIA_REFUSALS.listFilterInvalid),
];

/**
 * Validation for updating media
 * 
 * PUT /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Required:
 * - id: the card id, as the database writes it (path parameter; checked
 *   by the route, routes/v1/mediaRoutes.js)
 * - mediaId: Valid UUID of media (path parameter)
 * 
 * Optional (at least one field must be provided):
 * - caption: Max 255 characters
 * - position: Non-negative integer
 * - is_primary: Boolean
 */
export const validateUpdate = [
  // Media ID parameter validation: an id that names no file
  param('mediaId')
    .trim()
    .notEmpty()
    .withMessage(MEDIA_REFUSALS.mediaNotFound)
    .isUUID()
    .withMessage(MEDIA_REFUSALS.mediaNotFound),

  // Caption validation (optional)
  body('caption')
    .optional()
    .trim()
    .custom(captionFits)
    .withMessage(MEDIA_REFUSALS.captionTooLong),

  // Position validation (optional)
  // position is an integer column: past 2147483647 the database refused
  // (22003) and the partner read a 500
  body('position')
    .optional()
    .isInt({ min: 0, max: 2147483647 })
    .withMessage(MEDIA_REFUSALS.changeInvalid)
    .toInt(),

  // is_primary validation (optional)
  body('is_primary')
    .optional()
    .isBoolean()
    .withMessage(MEDIA_REFUSALS.changeInvalid)
    .toBoolean(),
];

/**
 * Validation for deleting media
 * 
 * DELETE /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Required:
 * - id: the card id, as the database writes it (path parameter; checked
 *   by the route, routes/v1/mediaRoutes.js)
 * - mediaId: Valid UUID of media (path parameter)
 */
export const validateDelete = [
  // Media ID parameter validation: an id that names no file
  param('mediaId')
    .trim()
    .notEmpty()
    .withMessage(MEDIA_REFUSALS.mediaNotFound)
    .isUUID()
    .withMessage(MEDIA_REFUSALS.mediaNotFound),
];

