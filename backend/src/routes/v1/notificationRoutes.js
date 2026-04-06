/**
 * Notification Routes
 *
 * All endpoints require authentication.
 * User can only access own notifications (userId from JWT).
 *
 * Route ordering: static paths (device-token, preferences, read-all, unread-count)
 * MUST come before parametric /:id/read to avoid Express matching them as :id.
 */

import express from 'express';
import * as NotificationController from '../../controllers/notificationController.js';
import * as DeviceTokenController from '../../controllers/deviceTokenController.js';
import * as NotificationPreferencesController from '../../controllers/notificationPreferencesController.js';
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

// =====================================================
// Static paths first (before /:id parametric routes)
// =====================================================

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
 * GET /api/v1/notifications/preferences
 * Get push notification preferences (returns defaults if no row)
 */
router.get(
  '/preferences',
  readLimiter,
  authenticate,
  NotificationPreferencesController.getPreferences,
);

/**
 * PUT /api/v1/notifications/read-all
 * Mark all unread as read
 */
router.put(
  '/read-all',
  writeLimiter,
  authenticate,
  NotificationController.markAllAsRead,
);

/**
 * PUT /api/v1/notifications/device-token
 * Register or reactivate FCM token (idempotent, called on every app start)
 */
router.put(
  '/device-token',
  writeLimiter,
  authenticate,
  DeviceTokenController.registerToken,
);

/**
 * PUT /api/v1/notifications/preferences
 * Create or update push notification preferences (UPSERT, partial update)
 */
router.put(
  '/preferences',
  writeLimiter,
  authenticate,
  NotificationPreferencesController.updatePreferences,
);

/**
 * DELETE /api/v1/notifications/device-token
 * Deactivate FCM token (called on logout)
 */
router.delete(
  '/device-token',
  writeLimiter,
  authenticate,
  DeviceTokenController.removeToken,
);

// =====================================================
// Parametric routes last
// =====================================================

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
