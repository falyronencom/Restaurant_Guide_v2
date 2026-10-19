/**
 * Promotion Routes
 *
 * Partner-facing promotion CRUD endpoints:
 *   POST   /api/v1/partner/promotions                              — create promotion
 *   GET    /api/v1/partner/promotions/establishment/:establishmentId — list promotions
 *   PATCH  /api/v1/partner/promotions/:id                          — update promotion
 *   DELETE /api/v1/partner/promotions/:id                          — deactivate promotion
 *
 * All endpoints require authentication and partner role.
 * Ownership verified at the service layer.
 *
 * File upload: POST and PATCH accept optional image via multipart/form-data.
 * Follows multer config pattern from mediaRoutes.js.
 */

import express from 'express';
import multer from 'multer';
import * as PromotionController from '../../controllers/promotionController.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { MULTIPART_LIMITS, createUpload, tempUploadStorage } from '../../middleware/upload.js';
import { PROMOTION_REFUSALS } from '../../constants/partnerSectionRefusals.js';

const router = express.Router();

// The refusal is an AppError, sent by errorHandler — 422
// INVALID_FILE_TYPE, the code and text of the service's own type check.
// Before 16.10.2026 it was a plain Error, which errorHandler answered with 500.
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(PROMOTION_REFUSALS.invalidImageType, 422, 'INVALID_FILE_TYPE'), false);
  }
};

// Storage: tempUploadStorage of middleware/upload.js — TEMP_UPLOAD_DIR, a UUID
// name with the extension of the file's type, never the client's.
const upload = createUpload({
  storage: tempUploadStorage,
  fileFilter,
  limits: {
    ...MULTIPART_LIMITS,
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// All promotion routes require authenticated partner
router.use(authenticate);
router.use(authorize(['partner']));

// POST / — create promotion (optional image)
router.post(
  '/',
  upload.single('image'),
  PromotionController.createPromotion,
);

// GET /establishment/:establishmentId — list promotions for partner's establishment
router.get(
  '/establishment/:establishmentId',
  PromotionController.getPromotions,
);

// PATCH /:id — update promotion (optional new image)
router.patch(
  '/:id',
  upload.single('image'),
  PromotionController.updatePromotion,
);

// DELETE /:id — deactivate promotion (soft delete)
router.delete(
  '/:id',
  PromotionController.deletePromotion,
);

// A picture above multer's limit (10 МБ) is refused before the service, so
// the service's own size refusal never answered it: the partner read multer's
// «File too large» (413, LIMIT_FILE_SIZE). The approved text now, with the
// same status and code; every other error goes on to errorHandler unchanged.
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return next(new AppError(PROMOTION_REFUSALS.imageTooLarge, 413, 'LIMIT_FILE_SIZE'));
  }
  return next(error);
});

export default router;
