/**
 * Promotion Service
 *
 * Business logic for promotion CRUD, image uploads, and validation.
 * Follows patterns from mediaService.js (ownership verification + Cloudinary upload).
 *
 * Phase 1: No subscription gating — all approved partners can create promotions.
 * Only limit: max 3 active promotions per establishment.
 */

import * as PromotionModel from '../models/promotionModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as CloudinaryUtil from '../config/cloudinary.js';
import * as NotificationService from './notificationService.js';
import { AppError } from '../middleware/errorHandler.js';
import { PROMOTION_REFUSALS } from '../constants/partnerSectionRefusals.js';
import { sendWithinDailyAllowance } from './uploadAllowance.js';
import logger from '../utils/logger.js';

/**
 * Create a promotion for an establishment.
 *
 * Flow: verify ownership → check active count → upload image (optional) → create record.
 *
 * @param {string} partnerId - UUID of authenticated partner
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} data - Promotion data (title, description, terms_and_conditions, valid_from, valid_until)
 * @param {Object|null} file - Uploaded image file (from multer), or null
 * @returns {Promise<Object>} Created promotion
 * @throws {AppError} 429 RATE_LIMIT_EXCEEDED (DailyUploadLimitError) when an image
 *   comes and the account's daily upload allowance is spent (services/uploadAllowance.js)
 */
export const createPromotion = async (partnerId, establishmentId, data, file = null) => {
  // Verify ownership
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(
      PROMOTION_REFUSALS.establishmentNotOwned,
      404,
      'ESTABLISHMENT_NOT_FOUND',
    );
  }

  // Check active promotion count
  const activeCount = await PromotionModel.getActiveCount(establishmentId);
  if (activeCount >= PromotionModel.MAX_ACTIVE_PROMOTIONS) {
    throw new AppError(
      PROMOTION_REFUSALS.activeLimit(PromotionModel.MAX_ACTIVE_PROMOTIONS),
      400,
      'PROMOTION_LIMIT_EXCEEDED',
    );
  }

  // Upload image to Cloudinary if provided
  let imageUrls = {};
  if (file) {
    if (!CloudinaryUtil.isValidImageType(file.mimetype)) {
      throw new AppError(
        PROMOTION_REFUSALS.invalidImageType,
        422,
        'INVALID_FILE_TYPE',
      );
    }
    if (!CloudinaryUtil.isValidImageSize(file.size)) {
      throw new AppError(
        PROMOTION_REFUSALS.imageTooLarge,
        422,
        'FILE_TOO_LARGE',
      );
    }

    // The account's daily upload allowance, shared with every uploader
    // (services/uploadAllowance.js): a spent one is a 429 AppError.
    const uploadResult = await sendWithinDailyAllowance(
      { userId: partnerId, bytes: file.size, message: PROMOTION_REFUSALS.dailyUploadLimit },
      () => CloudinaryUtil.uploadImage(file.path, establishmentId, 'promotions'),
    );
    const urls = CloudinaryUtil.generateAllResolutions(uploadResult.public_id);
    imageUrls = {
      image_url: urls.url,
      thumbnail_url: urls.thumbnail_url,
      preview_url: urls.preview_url,
    };
  }

  const promotion = await PromotionModel.createPromotion({
    establishment_id: establishmentId,
    title: data.title,
    description: data.description || null,
    terms_and_conditions: data.terms_and_conditions || null,
    valid_from: data.valid_from || null,
    valid_until: data.valid_until || null,
    position: data.position || 0,
    ...imageUrls,
  });

  // Notify users who favorited this establishment (non-blocking)
  NotificationService.notifyPromotionNew(establishmentId, data.title).catch(() => {});

  logger.info('Promotion created', {
    promotionId: promotion.id,
    establishmentId,
    partnerId,
    hasImage: !!file,
  });

  return promotion;
};

/**
 * Get all promotions of the partner's establishment — every status, the
 * partner's cabinet view (the public views read active ones through the model).
 *
 * Ownership first: the route checks only the role, and the model read starts
 * with the lazy expiry of this establishment's promotions — a write. Before
 * 30.09.2026 any partner read another establishment's promotions, inactive
 * included (review 23.09, #1). 403, like bookingService and the establishment
 * mutations; the other promotion actions still answer 404 (guarded as they are
 * by partner-ownership-guard.test.js).
 *
 * @param {string} partnerId - UUID of authenticated partner
 * @param {string} establishmentId - UUID
 * @returns {Promise<Object[]>} Promotions array
 */
export const getPartnerPromotions = async (partnerId, establishmentId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(PROMOTION_REFUSALS.establishmentNotOwned, 403, 'FORBIDDEN');
  }
  return PromotionModel.getPromotionsByEstablishment(establishmentId, true);
};

/**
 * Update a promotion. Verifies partner ownership before update.
 *
 * @param {string} partnerId - UUID
 * @param {string} promotionId - UUID
 * @param {Object} data - Fields to update
 * @param {Object|null} file - New image file, or null
 * @returns {Promise<Object>} Updated promotion
 * @throws {AppError} 429 RATE_LIMIT_EXCEEDED (DailyUploadLimitError) when a new
 *   image comes and the account's daily upload allowance is spent
 */
export const updatePromotion = async (partnerId, promotionId, data, file = null) => {
  const promotion = await PromotionModel.getPromotionById(promotionId);
  if (!promotion) {
    throw new AppError(PROMOTION_REFUSALS.promotionNotFound, 404, 'PROMOTION_NOT_FOUND');
  }

  // Verify ownership via establishment
  const isOwner = await EstablishmentModel.checkOwnership(promotion.establishment_id, partnerId);
  if (!isOwner) {
    throw new AppError(
      PROMOTION_REFUSALS.promotionNotFound,
      404,
      'PROMOTION_NOT_FOUND',
    );
  }

  // Upload new image if provided
  let imageUrls = {};
  if (file) {
    if (!CloudinaryUtil.isValidImageType(file.mimetype)) {
      throw new AppError(
        PROMOTION_REFUSALS.invalidImageType,
        422,
        'INVALID_FILE_TYPE',
      );
    }
    if (!CloudinaryUtil.isValidImageSize(file.size)) {
      throw new AppError(
        PROMOTION_REFUSALS.imageTooLarge,
        422,
        'FILE_TOO_LARGE',
      );
    }

    // Within the account's daily upload allowance, as on create
    const uploadResult = await sendWithinDailyAllowance(
      { userId: partnerId, bytes: file.size, message: PROMOTION_REFUSALS.dailyUploadLimit },
      () => CloudinaryUtil.uploadImage(file.path, promotion.establishment_id, 'promotions'),
    );
    const urls = CloudinaryUtil.generateAllResolutions(uploadResult.public_id);
    imageUrls = {
      image_url: urls.url,
      thumbnail_url: urls.thumbnail_url,
      preview_url: urls.preview_url,
    };
  }

  const updated = await PromotionModel.updatePromotion(promotionId, {
    ...data,
    ...imageUrls,
  });

  // The previous image goes LAST — after the new one is uploaded and its link
  // written. A failure at either earlier step leaves the promotion with its
  // previous picture (critics' pack 1, point 3 — Codex C-07; known as 23.09 #4b).
  // Only an asset on our cloud inside this card's folder, where uploadImage
  // files promotion images, is destroyed; deleteImage refuses the rest
  // (review 02.10.2026, N1). A failure here is logged: the promotion already
  // shows the new picture, and the old file is an orphan, not a loss.
  if (file && promotion.image_url) {
    try {
      const oldPublicId = CloudinaryUtil.ownCloudPublicId(promotion.image_url);
      if (oldPublicId) {
        await CloudinaryUtil.deleteImage(oldPublicId, [
          CloudinaryUtil.ownedFolders.establishment(promotion.establishment_id),
        ]);
      }
    } catch (err) {
      logger.warn('Failed to delete old promotion image', { error: err.message });
    }
  }

  logger.info('Promotion updated', {
    promotionId,
    partnerId,
    hasNewImage: !!file,
  });

  return updated;
};

/**
 * Deactivate a promotion (soft delete). Verifies ownership.
 *
 * @param {string} partnerId - UUID
 * @param {string} promotionId - UUID
 * @returns {Promise<Object>} Deactivated promotion
 */
export const deactivatePromotion = async (partnerId, promotionId) => {
  const promotion = await PromotionModel.getPromotionById(promotionId);
  if (!promotion) {
    throw new AppError(PROMOTION_REFUSALS.promotionNotFound, 404, 'PROMOTION_NOT_FOUND');
  }

  const isOwner = await EstablishmentModel.checkOwnership(promotion.establishment_id, partnerId);
  if (!isOwner) {
    throw new AppError(
      PROMOTION_REFUSALS.promotionNotFound,
      404,
      'PROMOTION_NOT_FOUND',
    );
  }

  const deactivated = await PromotionModel.deactivatePromotion(promotionId);

  logger.info('Promotion deactivated', { promotionId, partnerId });

  return deactivated;
};
