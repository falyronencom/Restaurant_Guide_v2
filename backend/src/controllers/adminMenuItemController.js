/**
 * Admin Menu-Item Controller
 *
 * HTTP handlers for admin moderation of parsed menu items (Segment B).
 * Thin layer: extracts request data, delegates to adminService, formats response.
 *
 * Endpoints:
 *   POST /api/v1/admin/menu-items/:id/hide
 *   POST /api/v1/admin/menu-items/:id/unhide
 *   POST /api/v1/admin/menu-items/:id/dismiss-flag
 *   GET  /api/v1/admin/menu-items/flagged
 */

import * as adminService from '../services/adminService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * POST /api/v1/admin/menu-items/:id/hide
 * Body: { reason: string }
 */
export const hideMenuItem = asyncHandler(async (req, res) => {
  const menuItemId = req.params.id;
  const { reason } = req.body;

  const result = await adminService.hideMenuItem(menuItemId, {
    reason,
    adminUserId: req.user.userId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  logger.info('Admin hid menu item', {
    adminId: req.user.userId,
    menuItemId,
    endpoint: 'POST /api/v1/admin/menu-items/:id/hide',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Menu item hidden',
  });
});

/**
 * POST /api/v1/admin/menu-items/:id/unhide
 */
export const unhideMenuItem = asyncHandler(async (req, res) => {
  const menuItemId = req.params.id;

  const result = await adminService.unhideMenuItem(menuItemId, {
    adminUserId: req.user.userId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  logger.info('Admin unhid menu item', {
    adminId: req.user.userId,
    menuItemId,
    endpoint: 'POST /api/v1/admin/menu-items/:id/unhide',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Menu item unhidden',
  });
});

/**
 * POST /api/v1/admin/menu-items/:id/dismiss-flag
 */
export const dismissMenuItemFlag = asyncHandler(async (req, res) => {
  const menuItemId = req.params.id;

  const result = await adminService.dismissMenuItemFlag(menuItemId, {
    adminUserId: req.user.userId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  logger.info('Admin dismissed sanity flag', {
    adminId: req.user.userId,
    menuItemId,
    endpoint: 'POST /api/v1/admin/menu-items/:id/dismiss-flag',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Sanity flag dismissed',
  });
});

/**
 * GET /api/v1/admin/menu-items/flagged
 * Query: ?page=1&per_page=20&reason=price_below_threshold
 */
export const listFlaggedMenuItems = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;
  const { reason } = req.query;

  const result = await adminService.getFlaggedMenuItems({ page, perPage, reason });

  res.status(200).json({
    success: true,
    data: result.items,
    meta: result.meta,
  });
});
