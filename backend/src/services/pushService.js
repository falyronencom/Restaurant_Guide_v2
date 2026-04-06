/**
 * Push Notification Service
 *
 * Core delivery module for FCM push notifications.
 * Non-blocking: all errors caught and logged, never thrown.
 * Callers use: pushService.sendPush(...).catch(() => {})
 *
 * Flow:
 * 1. Query active device tokens for user
 * 2. Check notification preferences (category opt-out)
 * 3. Send via FCM multicast
 * 4. Deactivate stale tokens reported by FCM
 */

import * as DeviceTokenModel from '../models/deviceTokenModel.js';
import * as NotificationPreferencesModel from '../models/notificationPreferencesModel.js';
import { isAvailable, getMessaging } from '../config/firebaseAdmin.js';
import logger from '../utils/logger.js';

/**
 * Notification type → preference category mapping
 *
 * Maps each notification type to the preference toggle that controls it.
 * Types mapped to null are never sent as push (in-app only).
 */
const TYPE_CATEGORY_MAP = {
  // Booking category
  booking_received: 'booking',
  booking_confirmed: 'booking',
  booking_declined: 'booking',
  booking_expired: 'booking',
  booking_cancelled: 'booking',

  // Reviews category
  new_review: 'reviews',
  partner_response: 'reviews',
  establishment_approved: 'reviews',
  establishment_rejected: 'reviews',
  establishment_suspended: 'reviews',
  establishment_unsuspended: 'reviews',

  // Promotions category
  promotion_new: 'promotions',

  // No push — in-app only
  establishment_claimed: null,
  review_hidden: null,
  review_deleted: null,
};

/**
 * Category → preferences field mapping
 */
const CATEGORY_PREF_FIELD = {
  booking: 'booking_push_enabled',
  reviews: 'reviews_push_enabled',
  promotions: 'promotions_push_enabled',
};

/**
 * Check if push is enabled for a notification type based on user preferences
 *
 * @param {string} type - Notification type
 * @param {Object} prefs - User preferences row
 * @returns {boolean}
 */
const isPushEnabledForType = (type, prefs) => {
  const category = TYPE_CATEGORY_MAP[type];

  // Type not in map or explicitly null → no push
  if (!category) return false;

  const prefField = CATEGORY_PREF_FIELD[category];
  if (!prefField) return false;

  // Default to true if field is undefined (new user, no preferences row)
  return prefs[prefField] !== false;
};

/**
 * Send push notification to a user's devices
 *
 * Non-blocking: catches all errors internally.
 *
 * @param {string} userId - Recipient user UUID
 * @param {Object} payload
 * @param {string} payload.title - Notification title
 * @param {string} payload.message - Notification body
 * @param {Object} [payload.data] - Custom data for deep linking
 * @param {string} [payload.data.type] - Notification type (for preference check)
 * @param {string} [payload.data.establishmentId]
 * @param {string} [payload.data.reviewId]
 * @param {string} [payload.data.bookingId]
 */
export const sendPush = async (userId, payload) => {
  try {
    // 0. Check Firebase availability
    if (!isAvailable()) {
      logger.debug('Push skipped: Firebase not configured', { userId });
      return;
    }

    const { title, message, data = {} } = payload;
    const notificationType = data.type;

    // 1. Check notification preferences
    if (notificationType) {
      const prefs = await NotificationPreferencesModel.getByUserId(userId);
      if (!isPushEnabledForType(notificationType, prefs)) {
        logger.debug('Push skipped: disabled by user preferences', {
          userId,
          type: notificationType,
        });
        return;
      }
    }

    // 2. Get active device tokens
    const tokens = await DeviceTokenModel.findByUserId(userId);
    if (tokens.length === 0) {
      logger.debug('Push skipped: no active device tokens', { userId });
      return;
    }

    // 3. Build FCM message
    const fcmTokens = tokens.map((t) => t.fcm_token);

    // Stringify data values — FCM data payload requires all string values
    const stringData = {};
    for (const [key, value] of Object.entries(data)) {
      if (value != null) {
        stringData[key] = String(value);
      }
    }

    const fcmMessage = {
      notification: {
        title,
        body: message,
      },
      data: stringData,
      tokens: fcmTokens,
    };

    // 4. Send via FCM multicast
    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast(fcmMessage);

    logger.info('Push sent', {
      userId,
      type: notificationType,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });

    // 5. Handle stale tokens
    if (response.failureCount > 0) {
      const staleTokenPromises = [];

      response.responses.forEach((resp, index) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          if (
            errorCode === 'messaging/registration-token-not-registered' ||
            errorCode === 'messaging/invalid-registration-token'
          ) {
            logger.info('Deactivating stale FCM token', {
              userId,
              tokenIndex: index,
              errorCode,
            });
            staleTokenPromises.push(
              DeviceTokenModel.deactivate(fcmTokens[index]),
            );
          }
        }
      });

      if (staleTokenPromises.length > 0) {
        await Promise.all(staleTokenPromises);
      }
    }
  } catch (error) {
    // Non-blocking: log and swallow
    logger.error('Push notification failed', {
      error: error.message,
      userId,
    });
  }
};

// Export category map for testing
export { TYPE_CATEGORY_MAP, CATEGORY_PREF_FIELD, isPushEnabledForType };
