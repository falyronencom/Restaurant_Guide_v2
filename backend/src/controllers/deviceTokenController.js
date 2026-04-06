/**
 * Device Token Controller
 *
 * HTTP layer for device token registration and removal.
 * All endpoints require authentication.
 */

import * as DeviceTokenService from '../services/deviceTokenService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * PUT /api/v1/notifications/device-token
 * Register or reactivate a device token (idempotent UPSERT)
 *
 * Body: { fcm_token, platform, device_name? }
 */
export const registerToken = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { fcm_token, platform, device_name } = req.body;

  const result = await DeviceTokenService.registerToken(userId, {
    fcm_token,
    platform,
    device_name,
  });

  res.json({
    success: true,
    data: result,
  });
});

/**
 * DELETE /api/v1/notifications/device-token
 * Deactivate a device token (logout)
 *
 * Body: { fcm_token }
 */
export const removeToken = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { fcm_token } = req.body;

  await DeviceTokenService.removeToken(userId, fcm_token);

  res.json({
    success: true,
    data: { message: 'Device token deactivated' },
  });
});
