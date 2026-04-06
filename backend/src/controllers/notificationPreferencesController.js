/**
 * Notification Preferences Controller
 *
 * HTTP layer for notification push preferences.
 * All endpoints require authentication.
 */

import * as NotificationPreferencesModel from '../models/notificationPreferencesModel.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * GET /api/v1/notifications/preferences
 * Get current notification preferences (returns defaults if no row)
 */
export const getPreferences = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const prefs = await NotificationPreferencesModel.getByUserId(userId);

  res.json({
    success: true,
    data: prefs,
  });
});

/**
 * PUT /api/v1/notifications/preferences
 * Create or update notification preferences (UPSERT, partial update)
 *
 * Body: { booking_push_enabled?, reviews_push_enabled?, promotions_push_enabled? }
 */
export const updatePreferences = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { booking_push_enabled, reviews_push_enabled, promotions_push_enabled } = req.body;

  // Validate: at least one field must be provided
  if (
    booking_push_enabled === undefined &&
    reviews_push_enabled === undefined &&
    promotions_push_enabled === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: 'At least one preference field is required',
    });
  }

  // Validate: fields must be boolean if provided
  const fields = { booking_push_enabled, reviews_push_enabled, promotions_push_enabled };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && typeof value !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: `${key} must be a boolean`,
      });
    }
  }

  const result = await NotificationPreferencesModel.upsert(userId, {
    booking_push_enabled,
    reviews_push_enabled,
    promotions_push_enabled,
  });

  res.json({
    success: true,
    data: result,
  });
});
