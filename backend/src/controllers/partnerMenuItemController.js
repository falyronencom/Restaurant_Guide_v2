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
import { giveBackRateLimitSlots } from '../middleware/rateLimiter.js';
import logger from '../utils/logger.js';

export const listMenuItems = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const partnerId = req.user.userId;

  const { items, recognition, hasHiddenItems } = await partnerMenuItemService.listMenuItems(partnerId, establishmentId);

  // `recognition` and `hasHiddenItems` sit beside `data`: `data` stays the
  // list of items every client reads; a client that does not know a field
  // ignores it.
  res.status(200).json({
    success: true,
    data: items,
    recognition,
    hasHiddenItems,
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

  let result;
  try {
    result = await partnerMenuItemService.retryOcr(partnerId, establishmentId);
  } catch (error) {
    // A failure of the server's — every queuing failed (OCR_RESTART_FAILED,
    // finding Н40 of 25.10.2026) or the database failed before them — is not
    // a restart the partner spent: the day's limit of five restarts
    // (routes/v1/establishmentRoutes.js) gets this one back. The app repeats
    // a request answered 5xx, and the repeats cost nothing either. A refusal
    // (no menu files, the spent daily allowance's 429, not the partner's
    // card) stays counted, as before.
    if ((error.statusCode ?? 500) >= 500) {
      await giveBackRateLimitSlots(req);
    }
    throw error;
  }

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
