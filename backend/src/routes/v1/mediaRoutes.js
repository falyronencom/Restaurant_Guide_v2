/**
 * Media Routes
 * 
 * This module defines all media management API endpoints for partners,
 * composing controllers, validation middleware, authentication middleware,
 * and multer file upload middleware into complete request handling pipelines.
 * 
 * Architecture note: Routes are declarative specifications of how requests flow
 * through middleware chains. They should be readable as documentation of the API
 * surface without containing any logic themselves.
 * 
 * File Upload Configuration:
 * These routes use multer middleware to handle multipart/form-data uploads.
 * Multer processes the file upload and makes it available in req.file for
 * the controller to access. The configuration includes file size limits,
 * storage location, and filename generation.
 * 
 * All endpoints in this file are partner-only and require authentication.
 * The base path is /api/v1/partner/establishments/:id/media when mounted.
 */

import express from 'express';
import multer from 'multer';
import * as MediaController from '../../controllers/mediaController.js';
import * as MediaValidation from '../../validators/mediaValidation.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { AppError, validatePersonText } from '../../middleware/errorHandler.js';
import { MULTIPART_LIMITS, createUpload, tempUploadStorage } from '../../middleware/upload.js';
import { UPLOAD_REFUSALS } from '../../constants/partnerSectionRefusals.js';
import { ESTABLISHMENT_REFUSALS } from '../../constants/establishmentRefusals.js';
import { isCanonicalUuid } from '../../utils/canonicalUuid.js';

const router = express.Router({ mergeParams: true });

/**
 * Configure multer for file uploads
 * 
 * Multer handles multipart/form-data and saves uploaded files to a temporary
 * directory before they're processed and uploaded to Cloudinary.
 * 
 * Configuration:
 * - Storage: tempUploadStorage of middleware/upload.js — TEMP_UPLOAD_DIR
 *   (backend/tmp/uploads, module-relative), a UUID name with the extension of
 *   the file's type, never the client's
 * - File filter: Only allow image types (jpeg, jpg, png, webp, heic)
 * - Size limit: 10MB maximum per file
 * 
 * The files are stored temporarily and should be cleaned up after Cloudinary
 * upload completes. A cron job or periodic cleanup process should remove old
 * files from TEMP_UPLOAD_DIR to prevent disk space issues.
 */
/**
 * File filter to accept only image types
 * 
 * This provides early rejection of non-image files at the multer level,
 * before the file is fully uploaded. This saves bandwidth and processing time.
 * 
 * Accepted MIME types:
 * - image/jpeg
 * - image/jpg
 * - image/png
 * - image/webp
 * - image/heic
 */
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
  const allowedPdfTypes = ['application/pdf'];

  if (allowedImageTypes.includes(file.mimetype) || allowedPdfTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, HEIC images and PDF files are allowed.'), false);
  }
};

/**
 * Create multer upload instance with configuration
 *
 * Size limit of 60MB accommodates both image uploads (further validated to
 * 10MB in the service layer) and PDF menu uploads (60MB ceiling). Enforcing
 * the per-type limit in the service keeps multer simple while still rejecting
 * oversized files early — though images up to 60MB reach the service before
 * being rejected. This is an acceptable trade-off: image size validation is
 * cheap and centralizing the check in the service keeps the pipeline uniform.
 */
const upload = createUpload({
  storage: tempUploadStorage,
  fileFilter,
  limits: {
    ...MULTIPART_LIMITS,
    fileSize: 60 * 1024 * 1024, // 60MB ceiling (PDF limit; images further capped to 10MB in service)
  },
});

/**
 * Apply authentication to all routes in this router
 * 
 * All media management endpoints require:
 * 1. Valid JWT token (authenticate middleware)
 * 2. 'partner' role (authorize middleware)
 * 
 * Note: We use mergeParams: true when creating the router to access
 * the :id parameter from the parent route (establishment ID).
 */
router.use(authenticate);
router.use(authorize(['partner']));

/**
 * The card id as the database writes it (utils/canonicalUuid.js), before the
 * upload is read: Postgres reads an id in capitals as the same card, but the
 * cloud folder is named after the id as the request wrote it
 * (config/cloudinary.js ownedFolders) — the file went to
 * establishments/<CAPITALS>/…, and the rollback after a refused write, or a
 * later delete, could not remove it (review of PR #112, finding 1). Anything
 * that is no UUID names no card either. The refusal is the one of a card that
 * is gone or not the caller's, with its code; until 20.10.2026 a non-UUID got
 * the validator's English 422.
 */
const requireCanonicalCardId = (req, res, next) => {
  if (isCanonicalUuid(req.params.id)) return next();
  return next(new AppError(ESTABLISHMENT_REFUSALS.notOwner, 404, 'ESTABLISHMENT_NOT_FOUND'));
};

router.use(requireCanonicalCardId);

/**
 * Upload a new media file
 * 
 * POST /api/v1/partner/establishments/:id/media
 * Content-Type: multipart/form-data
 * 
 * This endpoint handles image uploads for establishments. The file is first
 * uploaded to temporary storage via multer, then processed and uploaded to
 * Cloudinary by the service layer, and finally a database record is created.
 * 
 * Request:
 * - file: Image file (required, multipart/form-data field named 'file')
 * - type: Media type (required, form field: 'interior', 'exterior', 'menu', 'dishes')
 * - caption: Optional caption (form field, max 255 characters)
 * - is_primary: Optional boolean (form field, default: false)
 * 
 * Flow: 
 * Authentication → Authorization → Card id → Multer Upload → Validation → Controller → Service
 * 
 * The upload.single('file') middleware expects the file to be uploaded with
 * the field name 'file' in the multipart form data.
 * 
 * Protected: Yes (partner role required, ownership verified in service layer)
 * Rate Limited: Yes (50 requests/hour per partner for media uploads)
 */
router.post(
  '/',
  upload.single('file'), // Process file upload with field name 'file'
  MediaValidation.validateUpload,
  validatePersonText,
  MediaController.uploadMedia,
);

/**
 * Get all media for an establishment
 * 
 * GET /api/v1/partner/establishments/:id/media
 * 
 * Returns all media for the specified establishment, optionally filtered by type.
 * Results are ordered by position (for manual ordering) and creation date.
 * 
 * Query parameters:
 * - type: Optional media type filter ('interior', 'exterior', 'menu', 'dishes')
 * 
 * Flow:
 * Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * Returns: Array of media objects with all three resolution URLs
 * 
 * Protected: Yes (partner role required, ownership verified)
 */
router.get(
  '/',
  MediaValidation.validateGetMedia,
  validatePersonText,
  MediaController.getMedia,
);

/**
 * Update media details
 * 
 * PUT /api/v1/partner/establishments/:id/media/:mediaId
 * Content-Type: application/json
 * 
 * Allows partners to update media caption, position (for reordering), or
 * is_primary flag. The image URLs cannot be changed - to change an image,
 * delete and re-upload.
 * 
 * Path parameters:
 * - id: UUID of the establishment
 * - mediaId: UUID of the media to update
 * 
 * Request body (all fields optional):
 * - caption: New caption text (max 255 characters)
 * - position: New position number (non-negative integer)
 * - is_primary: Whether to set as primary photo (boolean)
 * 
 * Flow:
 * Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * Returns: Updated media object
 * 
 * Protected: Yes (partner role required, ownership verified)
 * 
 * Note: If is_primary is set to true, all other media for this establishment
 * will have is_primary set to false automatically.
 */
router.put(
  '/:mediaId',
  MediaValidation.validateUpdate,
  validatePersonText,
  MediaController.updateMedia,
);

/**
 * Delete media
 * 
 * DELETE /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Deletes media from both Cloudinary and the database. This is a permanent
 * operation that cannot be undone.
 * 
 * Path parameters:
 * - id: UUID of the establishment
 * - mediaId: UUID of the media to delete
 * 
 * Flow:
 * Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * The service layer handles:
 * 1. Verifying ownership
 * 2. Deleting from Cloudinary
 * 3. Deleting from database
 * 4. If deleted photo was primary, setting another as primary
 * 
 * Returns: Success confirmation
 * 
 * Protected: Yes (partner role required, ownership verified)
 */
router.delete(
  '/:mediaId',
  MediaValidation.validateDelete,
  validatePersonText,
  MediaController.deleteMedia,
);

/**
 * Error handler for multer upload errors
 * 
 * This middleware catches errors from multer (file size exceeded, invalid type, etc.)
 * and formats them as consistent API error responses. The partner reads the
 * texts of the wizard's upload (UPLOAD_REFUSALS — the same file rules, from
 * 19.10.2026; English before); the codes stay — the site translates by them
 * (web/src/lib/partner/errors.ts). multer's other refusals (Too many fields
 * and the like) — a request no client sends — answer with the form's one
 * sentence, UPLOAD_REFUSALS.formNotRead (from 20.10.2026; multer's English
 * before, the wizard's upload keeps it; multipart-limits.test.js holds both).
 *
 * This should be registered AFTER the routes that use multer uploads.
 */
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    // Handle multer-specific errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: UPLOAD_REFUSALS.fileTooLarge,
        error: {
          code: 'FILE_TOO_LARGE',
        },
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: UPLOAD_REFUSALS.unexpectedField,
        error: {
          code: 'INVALID_UPLOAD_FIELD',
        },
      });
    }

    // Any other multer refusal: the form's sentence, the code as before.
    return res.status(400).json({
      success: false,
      message: UPLOAD_REFUSALS.formNotRead,
      error: {
        code: 'UPLOAD_ERROR',
      },
    });
  }

  if (error.message && error.message.includes('Invalid file type')) {
    // Handle file filter errors: the filter's own text is English and internal
    return res.status(422).json({
      success: false,
      message: UPLOAD_REFUSALS.invalidFileType,
      error: {
        code: 'INVALID_FILE_TYPE',
      },
    });
  }

  // Pass other errors to global error handler
  next(error);
});

export default router;

