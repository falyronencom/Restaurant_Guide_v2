/**
 * Temporary Media Upload Routes
 *
 * This module provides endpoints for uploading media files before an establishment
 * is created. This is essential for the partner registration flow where users need
 * to upload photos on the Media step before the establishment exists in the database.
 *
 * The uploaded files are stored in Cloudinary in a temporary folder. When the
 * establishment is created, the URLs are already valid Cloudinary URLs that can
 * be stored directly in the establishment record.
 *
 * Architecture note: This is a separate route module because temporary uploads
 * have different authorization requirements (user or partner) and don't require
 * establishment ownership verification.
 *
 * Base path: /api/v1/partner/media when mounted in v1/index.js
 */

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import { authenticate, authorize } from '../../middleware/auth.js';
import { AppError, validate } from '../../middleware/errorHandler.js';
import { MULTIPART_LIMITS, createUpload, tempUploadStorage } from '../../middleware/upload.js';
import { body } from 'express-validator';
import * as CloudinaryUtil from '../../config/cloudinary.js';
import { UPLOAD_REFUSALS } from '../../constants/partnerSectionRefusals.js';
import { DailyUploadLimitError, sendWithinDailyAllowance } from '../../services/uploadAllowance.js';
import logger from '../../utils/logger.js';
// A refused file is removed without waiting (the answer goes out at once);
// discardTempUpload never rejects and logs a removal that failed — the bare
// unlink before 19.10.2026 dropped that failure.
import { discardTempUpload } from '../../utils/tempUpload.js';

const router = express.Router();

/**
 * File filter to accept image types and PDF
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
 * Create multer upload instance
 *
 * 60MB ceiling covers PDF menu uploads; images capped to 10MB in request handler.
 * Storage: tempUploadStorage of middleware/upload.js — TEMP_UPLOAD_DIR, a
 * UUID name with the extension of the file's type, never the client's.
 */
const upload = createUpload({
  storage: tempUploadStorage,
  fileFilter,
  limits: {
    ...MULTIPART_LIMITS,
    fileSize: 60 * 1024 * 1024, // 60MB ceiling (PDF); images further capped to 10MB in handler
  },
});

/**
 * Apply authentication to all routes
 * Allow both 'user' and 'partner' roles since users upload photos during registration
 */
router.use(authenticate);
router.use(authorize(['user', 'partner']));

/**
 * Valid media type values
 */
const VALID_MEDIA_TYPES = ['interior', 'exterior', 'menu', 'dishes'];

/**
 * Validation for temporary media upload
 */
const validateTempUpload = [
  body('type')
    .trim()
    .notEmpty()
    .withMessage('Media type is required')
    .isIn(VALID_MEDIA_TYPES)
    .withMessage(`Media type must be one of: ${VALID_MEDIA_TYPES.join(', ')}`),
];

/**
 * Upload a temporary media file
 *
 * POST /api/v1/partner/media/upload
 * Content-Type: multipart/form-data
 *
 * This endpoint handles image uploads during partner registration before an
 * establishment exists. The file is uploaded to Cloudinary in a temporary folder
 * and the URL is returned for storage in the registration form state.
 *
 * Request:
 * - file: Image file (required, multipart/form-data field named 'file')
 * - type: Media type (required: 'interior', 'exterior', 'menu', 'dishes')
 *
 * Response:
 * - url: Full resolution Cloudinary URL
 * - thumbnail_url: Thumbnail resolution URL
 * - preview_url: Preview resolution URL
 *
 * 429 RATE_LIMIT_EXCEEDED once the account's daily allowance of files or bytes
 * is spent (services/uploadAllowance.js, renewed at Minsk midnight).
 *
 * Protected: Yes (user or partner role required)
 */
router.post(
  '/upload',
  upload.single('file'),
  validateTempUpload,
  validate,
  async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const { type } = req.body;

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: UPLOAD_REFUSALS.fileRequired,
          error: {
            code: 'FILE_REQUIRED',
          },
        });
      }

      const isPdfUpload = req.file.mimetype === 'application/pdf';

      if (isPdfUpload) {
        // PDF path — only allowed with type='menu'
        if (type !== 'menu') {
          discardTempUpload(req.file);
          return res.status(422).json({
            success: false,
            message: UPLOAD_REFUSALS.pdfOnlyInMenu,
            error: { code: 'PDF_TYPE_MISMATCH' },
          });
        }

        // Mimetype is client-supplied: a PDF-compatible .ai arrives as
        // application/pdf, so the extension is the discriminating check.
        if (!CloudinaryUtil.hasValidPdfExtension(req.file.originalname)) {
          discardTempUpload(req.file);
          return res.status(422).json({
            success: false,
            message: UPLOAD_REFUSALS.invalidFileType,
            error: { code: 'INVALID_FILE_TYPE' },
          });
        }

        if (!CloudinaryUtil.isValidPdfSize(req.file.size)) {
          discardTempUpload(req.file);
          return res.status(422).json({
            success: false,
            message: UPLOAD_REFUSALS.pdfTooLarge,
            error: { code: 'FILE_TOO_LARGE' },
          });
        }

        // The cloud would refuse it after the transfer (config/cloudinary.js
        // CLOUD_MAX_FILE_MB): refused here, with the reason and a way out.
        if (!CloudinaryUtil.fitsCloudFileLimit(req.file.size)) {
          discardTempUpload(req.file);
          return res.status(422).json({
            success: false,
            message: UPLOAD_REFUSALS.pdfOverCloudLimit(CloudinaryUtil.CLOUD_MAX_FILE_MB),
            error: { code: 'FILE_TOO_LARGE' },
          });
        }

        const pdfUploadResult = await sendWithinDailyAllowance(
          { userId, bytes: req.file.size, message: UPLOAD_REFUSALS.dailyLimit },
          () => CloudinaryUtil.uploadPdf(req.file.path, `temp/${userId}`),
        );

        const urlValue = pdfUploadResult.secure_url;
        const thumbnailUrl = CloudinaryUtil.generatePdfThumbnailUrl(pdfUploadResult.public_id);
        const previewUrl = CloudinaryUtil.generatePdfPreviewUrl(pdfUploadResult.public_id);

        fs.unlink(req.file.path, (err) => {
          if (err) {
            logger.warn('Failed to clean up temp PDF file', { path: req.file.path, error: err.message });
          }
        });

        logger.info('Temporary PDF uploaded', {
          userId,
          publicId: pdfUploadResult.public_id,
          pages: pdfUploadResult.pages,
          bytes: pdfUploadResult.bytes,
          endpoint: 'POST /api/v1/partner/media/upload',
        });

        return res.status(201).json({
          success: true,
          data: {
            url: urlValue,
            thumbnail_url: thumbnailUrl,
            preview_url: previewUrl,
            public_id: pdfUploadResult.public_id,
            file_type: 'pdf',
          },
        });
      }

      // Image path (unchanged behavior, validators/uploader scoped to images).
      // Extension checked alongside the mimetype — both are required (§ mimetype
      // is client-supplied, see cloudinary.js extension helpers).
      if (
        !CloudinaryUtil.isValidImageType(req.file.mimetype) ||
        !CloudinaryUtil.hasValidImageExtension(req.file.originalname)
      ) {
        discardTempUpload(req.file);
        return res.status(422).json({
          success: false,
          message: UPLOAD_REFUSALS.invalidFileType,
          error: {
            code: 'INVALID_FILE_TYPE',
          },
        });
      }

      if (!CloudinaryUtil.isValidImageSize(req.file.size)) {
        discardTempUpload(req.file);
        return res.status(422).json({
          success: false,
          message: UPLOAD_REFUSALS.photoTooLarge,
          error: {
            code: 'FILE_TOO_LARGE',
          },
        });
      }

      const uploadResult = await sendWithinDailyAllowance(
        { userId, bytes: req.file.size, message: UPLOAD_REFUSALS.dailyLimit },
        () => CloudinaryUtil.uploadImage(req.file.path, `temp/${userId}`, type),
      );

      const urls = CloudinaryUtil.generateAllResolutions(uploadResult.public_id);

      fs.unlink(req.file.path, (err) => {
        if (err) {
          logger.warn('Failed to clean up temp file', { path: req.file.path, error: err.message });
        }
      });

      logger.info('Temporary media uploaded', {
        userId,
        type,
        publicId: uploadResult.public_id,
        endpoint: 'POST /api/v1/partner/media/upload',
      });

      res.status(201).json({
        success: true,
        data: {
          url: urls.url,
          thumbnail_url: urls.thumbnail_url,
          preview_url: urls.preview_url,
          public_id: uploadResult.public_id,
          file_type: 'image',
        },
      });
    } catch (error) {
      // Clean up file if it exists
      if (req.file && req.file.path) {
        discardTempUpload(req.file);
      }

      // The day's allowance is spent: the client's refusal (429), sent by
      // errorHandler with its details and Retry-After — not a failure.
      if (error instanceof DailyUploadLimitError) {
        return next(error);
      }

      logger.error('Error uploading temporary media', {
        error: error.message,
        code: error.code,
        stack: error.stack,
        userId: req.user?.userId,
      });

      // Past the checks above a failure is the cloud's or ours, never the
      // file's: the partner reads one sentence, the inner text and code stay
      // in the log just written. The code is what the error handler gives any
      // inner error of a 5xx — not the caught error's own (a Node ERR_* code).
      return next(new AppError(UPLOAD_REFUSALS.uploadFailed, 500, 'INTERNAL_ERROR'));
    }
  },
);

/**
 * Error handler for multer upload errors
 */
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
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

    return res.status(400).json({
      success: false,
      message: error.message,
      error: {
        code: 'UPLOAD_ERROR',
      },
    });
  }

  // The filter's own error text is English and internal; the partner reads
  // the approved sentence.
  if (error.message && error.message.includes('Invalid file type')) {
    return res.status(422).json({
      success: false,
      message: UPLOAD_REFUSALS.invalidFileType,
      error: {
        code: 'INVALID_FILE_TYPE',
      },
    });
  }

  next(error);
});

export default router;
