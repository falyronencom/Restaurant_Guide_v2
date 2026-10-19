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
 */

import { body, param, query } from 'express-validator';
import { longerThan } from '../utils/textLength.js';

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
const captionFits = (value) => typeof value === 'string' && !longerThan(value, CAPTION_MAX_CHARS);

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
 * - id: Valid UUID of establishment (path parameter)
 * - type: Valid media type ('interior', 'exterior', 'menu', 'dishes')
 * - file: Image file (handled by multer, not validated here)
 * 
 * Optional:
 * - caption: Max 255 characters
 * - is_primary: Boolean
 */
export const validateUpload = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Media type validation
  body('type')
    .trim()
    .notEmpty()
    .withMessage('Media type is required')
    .isIn(VALID_MEDIA_TYPES)
    .withMessage(`Media type must be one of: ${VALID_MEDIA_TYPES.join(', ')}`),

  // Caption validation (optional)
  body('caption')
    .optional()
    .trim()
    .custom(captionFits)
    .withMessage('Caption must not exceed 255 characters'),

  // is_primary validation (optional, defaults to false)
  body('is_primary')
    .optional()
    .isBoolean()
    .withMessage('is_primary must be a boolean value (true or false)')
    .toBoolean(),
];

/**
 * Validation for getting media list
 * 
 * GET /api/v1/partner/establishments/:id/media
 * 
 * Required:
 * - id: Valid UUID of establishment (path parameter)
 * 
 * Optional:
 * - type: Valid media type for filtering
 */
export const validateGetMedia = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Type query parameter validation (optional filter)
  query('type')
    .optional()
    .isIn(VALID_MEDIA_TYPES)
    .withMessage(`Type filter must be one of: ${VALID_MEDIA_TYPES.join(', ')}`),
];

/**
 * Validation for updating media
 * 
 * PUT /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Required:
 * - id: Valid UUID of establishment (path parameter)
 * - mediaId: Valid UUID of media (path parameter)
 * 
 * Optional (at least one field must be provided):
 * - caption: Max 255 characters
 * - position: Non-negative integer
 * - is_primary: Boolean
 */
export const validateUpdate = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Media ID parameter validation
  param('mediaId')
    .trim()
    .notEmpty()
    .withMessage('Media ID is required')
    .isUUID()
    .withMessage('Media ID must be a valid UUID'),

  // Caption validation (optional)
  body('caption')
    .optional()
    .trim()
    .custom(captionFits)
    .withMessage('Caption must not exceed 255 characters'),

  // Position validation (optional)
  body('position')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Position must be a non-negative integer')
    .toInt(),

  // is_primary validation (optional)
  body('is_primary')
    .optional()
    .isBoolean()
    .withMessage('is_primary must be a boolean value (true or false)')
    .toBoolean(),
];

/**
 * Validation for deleting media
 * 
 * DELETE /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Required:
 * - id: Valid UUID of establishment (path parameter)
 * - mediaId: Valid UUID of media (path parameter)
 */
export const validateDelete = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Media ID parameter validation
  param('mediaId')
    .trim()
    .notEmpty()
    .withMessage('Media ID is required')
    .isUUID()
    .withMessage('Media ID must be a valid UUID'),
];

