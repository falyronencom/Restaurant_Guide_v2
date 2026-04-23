/**
 * Partner Menu-Item Service
 *
 * Business logic for partner operations on parsed menu items (Segment B):
 *   - listMenuItems:    GET /partner/establishments/:id/menu-items
 *   - updateMenuItem:   PATCH /partner/menu-items/:id (inline editing)
 *   - retryOcr:         POST /partner/establishments/:id/retry-ocr
 *
 * Ownership invariant: every entry point verifies that the menu item (or its
 * establishment) belongs to the calling partner before mutating or returning data.
 */

import * as MenuItemModel from '../models/menuItemModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as MediaModel from '../models/mediaModel.js';
import * as OcrJobModel from '../models/ocrJobModel.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * List parsed menu items for an establishment owned by the partner.
 * Includes admin-hidden items (flagged visually in UI) and sanity_flag values.
 *
 * @param {string} partnerId - UUID
 * @param {string} establishmentId - UUID
 * @returns {Promise<Object[]>} Menu items ordered by position
 */
export const listMenuItems = async (partnerId, establishmentId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(
      'Establishment not found or access denied',
      404,
      'ESTABLISHMENT_NOT_FOUND',
    );
  }

  return MenuItemModel.getByEstablishmentId(establishmentId, { includeHidden: true });
};

/**
 * Inline-edit a menu item the partner owns.
 *
 * Allowed fields: item_name, price_byn, category_raw.
 * Side effect: sanity_flag is cleared (partner accepts responsibility for values).
 * is_hidden_by_admin is untouched — only admin can toggle that.
 *
 * @param {string} partnerId - UUID
 * @param {string} menuItemId - UUID
 * @param {Object} updates - { item_name?, price_byn?, category_raw? }
 * @returns {Promise<Object>} Updated menu item
 */
export const updateMenuItem = async (partnerId, menuItemId, updates) => {
  const existing = await MenuItemModel.findById(menuItemId);
  if (!existing) {
    throw new AppError('Menu item not found', 404, 'MENU_ITEM_NOT_FOUND');
  }

  const isOwner = await EstablishmentModel.checkOwnership(
    existing.establishment_id,
    partnerId,
  );
  if (!isOwner) {
    throw new AppError(
      'Menu item not found or access denied',
      404,
      'MENU_ITEM_NOT_FOUND',
    );
  }

  const partnerAllowed = ['item_name', 'price_byn', 'category_raw'];
  const filteredUpdates = {};
  for (const field of partnerAllowed) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new AppError(
      'No editable fields provided (item_name, price_byn, category_raw)',
      400,
      'NO_FIELDS_TO_UPDATE',
    );
  }

  // Validate price if provided: must be non-negative number
  if (filteredUpdates.price_byn !== undefined && filteredUpdates.price_byn !== null) {
    const price = Number(filteredUpdates.price_byn);
    if (!Number.isFinite(price) || price < 0) {
      throw new AppError(
        'price_byn must be a non-negative number',
        422,
        'INVALID_PRICE',
      );
    }
  }

  // Partner edit implies they vouch for the values — clear sanity_flag.
  filteredUpdates.sanity_flag = null;

  const updated = await MenuItemModel.updateById(menuItemId, filteredUpdates);

  logger.info('Partner edited menu item', {
    menuItemId,
    partnerId,
    fields: Object.keys(filteredUpdates),
  });

  return updated;
};

/**
 * Re-run OCR for all PDF menus of an establishment owned by the partner.
 * Idempotency in OcrJobModel.enqueue ensures existing pending/processing jobs
 * are not duplicated.
 *
 * @param {string} partnerId - UUID
 * @param {string} establishmentId - UUID
 * @returns {Promise<{enqueuedJobs: number, totalPdfs: number}>}
 */
export const retryOcr = async (partnerId, establishmentId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(
      'Establishment not found or access denied',
      404,
      'ESTABLISHMENT_NOT_FOUND',
    );
  }

  const pdfs = await MediaModel.getPdfMediaByEstablishment(establishmentId);
  if (pdfs.length === 0) {
    throw new AppError(
      'No PDF menus to re-process for this establishment',
      400,
      'NO_PDF_MENUS',
    );
  }

  let enqueuedJobs = 0;
  for (const pdf of pdfs) {
    try {
      await OcrJobModel.enqueue({ establishmentId, mediaId: pdf.id });
      enqueuedJobs += 1;
    } catch (err) {
      logger.error('Failed to enqueue OCR job during retry', {
        error: err.message,
        mediaId: pdf.id,
        establishmentId,
      });
    }
  }

  logger.info('Partner requested OCR retry', {
    partnerId,
    establishmentId,
    totalPdfs: pdfs.length,
    enqueuedJobs,
  });

  return { enqueuedJobs, totalPdfs: pdfs.length };
};
