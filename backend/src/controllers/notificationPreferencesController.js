/**
 * Notification Preferences Controller
 *
 * HTTP layer for notification push preferences.
 * All endpoints require authentication.
 */

import * as NotificationPreferencesModel from '../models/notificationPreferencesModel.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { ACCOUNT_INACTIVE_TEXT } from '../constants/authRefusals.js';

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
 * Body: { booking_push_enabled?, reviews_push_enabled?, promotions_push_enabled?,
 *         menu_push_enabled? }
 * Fields left out keep their current value — a client built before
 * menu_push_enabled existed (migration 033) never resets it.
 */
export const updatePreferences = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const {
    booking_push_enabled,
    reviews_push_enabled,
    promotions_push_enabled,
    menu_push_enabled,
  } = req.body;

  const fields = {
    booking_push_enabled,
    reviews_push_enabled,
    promotions_push_enabled,
    menu_push_enabled,
  };

  // Validate: at least one field must be provided
  if (Object.values(fields).every((value) => value === undefined)) {
    return res.status(400).json({
      success: false,
      message: 'At least one preference field is required',
    });
  }

  // Validate: fields must be boolean if provided
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && typeof value !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: `${key} must be a boolean`,
      });
    }
  }

  const result = await NotificationPreferencesModel.upsert(userId, fields);
  // Nothing is written for an account switched off or deleted since the
  // request signed in (critic 2Г, 2.03).
  if (!result) {
    throw new AppError(ACCOUNT_INACTIVE_TEXT, 403, 'USER_INACTIVE');
  }

  res.json({
    success: true,
    data: result,
  });
});
