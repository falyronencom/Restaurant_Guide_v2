/**
 * Device Token Service
 *
 * Business logic for device token management.
 * Thin validation layer over deviceTokenModel.
 */

import * as DeviceTokenModel from '../models/deviceTokenModel.js';
import logger from '../utils/logger.js';

const VALID_PLATFORMS = ['ios', 'android'];

/**
 * Register or reactivate a device token
 *
 * @param {string} userId
 * @param {Object} data
 * @param {string} data.fcm_token
 * @param {string} data.platform - 'ios' | 'android'
 * @param {string} [data.device_name]
 * @returns {Promise<Object>} Token record
 */
export const registerToken = async (userId, data) => {
  const { fcm_token, platform, device_name } = data;

  if (!fcm_token || typeof fcm_token !== 'string' || fcm_token.trim().length === 0) {
    const error = new Error('fcm_token is required');
    error.status = 400;
    throw error;
  }

  if (!VALID_PLATFORMS.includes(platform)) {
    const error = new Error(`platform must be one of: ${VALID_PLATFORMS.join(', ')}`);
    error.status = 400;
    throw error;
  }

  return DeviceTokenModel.create({
    userId,
    fcmToken: fcm_token.trim(),
    platform,
    deviceName: device_name || null,
  });
};

/**
 * Deactivate a device token for a user (logout)
 *
 * @param {string} userId
 * @param {string} fcmToken
 * @returns {Promise<number>} Rows affected
 */
export const removeToken = async (userId, fcmToken) => {
  if (!fcmToken || typeof fcmToken !== 'string') {
    const error = new Error('fcm_token is required');
    error.status = 400;
    throw error;
  }

  return DeviceTokenModel.deactivateForUser(fcmToken.trim(), userId);
};

/**
 * Get all active tokens for a user
 *
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export const getUserTokens = async (userId) => {
  return DeviceTokenModel.findByUserId(userId);
};
