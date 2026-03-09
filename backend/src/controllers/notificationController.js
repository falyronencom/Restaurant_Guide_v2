/**
 * Notification Controller
 *
 * HTTP layer for notification endpoints.
 * All endpoints require authentication — user accesses only own notifications.
 */

import * as NotificationService from '../services/notificationService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * GET /api/v1/notifications
 * List user's notifications with pagination and filters
 *
 * Query params: page, limit, is_read (boolean), category ('establishments'|'reviews')
 */
export const getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { page, limit, is_read, category } = req.query;

  const filters = {};
  if (page) filters.page = parseInt(page, 10);
  if (limit) filters.limit = Math.min(parseInt(limit, 10), 50);

  if (typeof is_read !== 'undefined') {
    filters.is_read = is_read === 'true';
  }

  if (category && ['establishments', 'reviews'].includes(category)) {
    filters.category = category;
  }

  const result = await NotificationService.getUserNotifications(userId, filters);

  res.json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/v1/notifications/unread-count
 * Lightweight endpoint for polling unread badge count
 */
export const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const count = await NotificationService.getUnreadCount(userId);

  res.json({
    success: true,
    data: { count },
  });
});

/**
 * PUT /api/v1/notifications/:id/read
 * Mark a single notification as read (user can only mark own)
 */
export const markAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { id } = req.params;

  const result = await NotificationService.markAsRead(id, userId);

  if (!result) {
    throw new AppError(
      'Notification not found or does not belong to you',
      404,
      'NOTIFICATION_NOT_FOUND',
    );
  }

  res.json({
    success: true,
    data: result,
  });
});

/**
 * PUT /api/v1/notifications/read-all
 * Mark all unread notifications as read for the authenticated user
 */
export const markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const count = await NotificationService.markAllAsRead(userId);

  res.json({
    success: true,
    data: { marked: count },
  });
});
