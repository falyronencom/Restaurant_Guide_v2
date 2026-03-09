/**
 * Notification Routes
 *
 * All endpoints require authentication.
 * User can only access own notifications (userId from JWT).
 */

import express from 'express';
import * as NotificationController from '../../controllers/notificationController.js';
import { authenticate } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';

const router = express.Router();

// Rate limiters
const readLimiter = createRateLimiter({
  limit: 100,
  windowSeconds: 60,
  keyPrefix: 'notifications_read',
});

const writeLimiter = createRateLimiter({
  limit: 50,
  windowSeconds: 60,
  keyPrefix: 'notifications_write',
});

/**
 * GET /api/v1/notifications
 * Paginated list with optional filters: page, limit, is_read, category
 */
router.get(
  '/',
  readLimiter,
  authenticate,
  NotificationController.getNotifications,
);

/**
 * GET /api/v1/notifications/unread-count
 * Lightweight polling endpoint for badge count
 */
router.get(
  '/unread-count',
  readLimiter,
  authenticate,
  NotificationController.getUnreadCount,
);

/**
 * PUT /api/v1/notifications/read-all
 * Mark all unread as read (must be before /:id/read to avoid route collision)
 */
router.put(
  '/read-all',
  writeLimiter,
  authenticate,
  NotificationController.markAllAsRead,
);

/**
 * PUT /api/v1/notifications/:id/read
 * Mark single notification as read
 */
router.put(
  '/:id/read',
  writeLimiter,
  authenticate,
  NotificationController.markAsRead,
);

export default router;
