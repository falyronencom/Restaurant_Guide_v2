/**
 * Partner Menu-Item Controller
 *
 * HTTP handlers for partner-scoped menu-item endpoints (Segment B).
 *
 *   GET   /api/v1/partner/establishments/:id/menu-items
 *   PATCH /api/v1/partner/menu-items/:id
 *   POST  /api/v1/partner/establishments/:id/retry-ocr
 */

import * as partnerMenuItemService from '../services/partnerMenuItemService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

export const listMenuItems = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const partnerId = req.user.userId;

  const items = await partnerMenuItemService.listMenuItems(partnerId, establishmentId);

  res.status(200).json({
    success: true,
    data: items,
  });
});

export const updateMenuItem = asyncHandler(async (req, res) => {
  const menuItemId = req.params.id;
  const partnerId = req.user.userId;
  const { item_name, price_byn, category_raw } = req.body;

  const updated = await partnerMenuItemService.updateMenuItem(partnerId, menuItemId, {
    item_name,
    price_byn,
    category_raw,
  });

  logger.info('Partner updated menu item', {
    partnerId,
    menuItemId,
    endpoint: 'PATCH /api/v1/partner/menu-items/:id',
  });

  res.status(200).json({
    success: true,
    data: updated,
    message: 'Menu item updated',
  });
});

export const retryOcr = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const partnerId = req.user.userId;

  const result = await partnerMenuItemService.retryOcr(partnerId, establishmentId);

  logger.info('Partner retried OCR', {
    partnerId,
    establishmentId,
    enqueuedJobs: result.enqueuedJobs,
    endpoint: 'POST /api/v1/partner/establishments/:id/retry-ocr',
  });

  res.status(202).json({
    success: true,
    data: result,
    message: `Enqueued ${result.enqueuedJobs} OCR job(s)`,
  });
});
