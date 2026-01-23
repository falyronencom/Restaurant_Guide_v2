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
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/errorHandler.js';
import { body } from 'express-validator';
import * as CloudinaryUtil from '../../config/cloudinary.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// Ensure upload directory exists
const uploadDir = 'backend/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Configure multer for temporary file uploads
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

/**
 * File filter to accept only image types
 */
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and HEIC images are allowed.'), false);
  }
};

/**
 * Create multer upload instance
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB maximum file size
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
          message: 'No file uploaded',
          error: {
            code: 'FILE_REQUIRED',
          },
        });
      }

      // Validate file type
      if (!CloudinaryUtil.isValidImageType(req.file.mimetype)) {
        // Clean up uploaded file
        fs.unlink(req.file.path, () => {});
        return res.status(422).json({
          success: false,
          message: 'Invalid file type. Accepted formats: JPEG, PNG, WebP, HEIC',
          error: {
            code: 'INVALID_FILE_TYPE',
          },
        });
      }

      // Validate file size
      if (!CloudinaryUtil.isValidImageSize(req.file.size)) {
        // Clean up uploaded file
        fs.unlink(req.file.path, () => {});
        return res.status(422).json({
          success: false,
          message: 'File size exceeds 10MB limit',
          error: {
            code: 'FILE_TOO_LARGE',
          },
        });
      }

      // Upload to Cloudinary with temporary folder structure
      // Using user ID to organize temporary uploads
      const uploadResult = await CloudinaryUtil.uploadImage(
        req.file.path,
        `temp/${userId}`,
        type,
      );

      // Generate URLs for all three resolutions
      const urls = CloudinaryUtil.generateAllResolutions(uploadResult.public_id);

      // Clean up temporary file
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

      // Return success response with all URLs
      res.status(201).json({
        success: true,
        data: {
          url: urls.url,
          thumbnail_url: urls.thumbnail_url,
          preview_url: urls.preview_url,
          public_id: uploadResult.public_id,
        },
      });
    } catch (error) {
      // Clean up file if it exists
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, () => {});
      }

      logger.error('Error uploading temporary media', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.userId,
      });

      next(error);
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
        message: 'File size exceeds 10MB limit',
        error: {
          code: 'FILE_TOO_LARGE',
        },
      });
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field in file upload',
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

  if (error.message && error.message.includes('Invalid file type')) {
    return res.status(422).json({
      success: false,
      message: error.message,
      error: {
        code: 'INVALID_FILE_TYPE',
      },
    });
  }

  next(error);
});

export default router;
