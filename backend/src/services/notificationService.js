/**
 * Notification Service
 *
 * Core notification methods + trigger helpers called from other services.
 * Trigger helpers are NON-BLOCKING — they catch errors internally
 * and never break the primary operation (same pattern as audit log).
 */

import * as NotificationModel from '../models/notificationModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as ReviewModel from '../models/reviewModel.js';
import logger from '../utils/logger.js';

// ============================================================================
// Notification titles (Russian, hardcoded per project pattern)
// ============================================================================

const TITLES = {
  establishment_approved: 'Заведение одобрено',
  establishment_rejected: 'Заведение отклонено',
  establishment_suspended: 'Заведение приостановлено',
  establishment_unsuspended: 'Заведение возобновлено',
  new_review: 'Новый отзыв',
  partner_response: 'Ответ на ваш отзыв',
  review_hidden: 'Отзыв скрыт модератором',
  review_deleted: 'Отзыв удалён модератором',
  establishment_claimed: 'Заведение добавлено в ваш кабинет',
  booking_received: 'Новая бронь',
  booking_confirmed: 'Бронь подтверждена',
  booking_declined: 'Бронь отклонена',
  booking_expired: 'Бронь истекла',
  booking_cancelled: 'Бронь отменена',
};

const VALID_TYPES = Object.keys(TITLES);

// ============================================================================
// Core methods (called from controller)
// ============================================================================

/**
 * Create a notification (with validation)
 */
export const createNotification = async (data) => {
  const { userId, type, title, message, establishmentId, reviewId } = data;

  if (!userId || !type || !title) {
    throw new Error('userId, type, and title are required');
  }

  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid notification type: ${type}`);
  }

  return NotificationModel.create({
    userId,
    type,
    title,
    message,
    establishmentId,
    reviewId,
  });
};

/**
 * Get user's notifications (paginated, filterable)
 */
export const getUserNotifications = async (userId, filters = {}) => {
  const { page = 1, limit = 20, is_read, category } = filters;
  const offset = (page - 1) * limit;

  const options = { limit, offset };

  if (typeof is_read === 'boolean') {
    options.isRead = is_read;
  }

  if (category) {
    options.category = category;
  }

  const { items, total } = await NotificationModel.getByUserId(userId, options);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get unread count for a user
 */
export const getUnreadCount = async (userId) => {
  return NotificationModel.getUnreadCount(userId);
};

/**
 * Mark single notification as read
 */
export const markAsRead = async (notificationId, userId) => {
  return NotificationModel.markAsRead(notificationId, userId);
};

/**
 * Mark all notifications as read for a user
 */
export const markAllAsRead = async (userId) => {
  return NotificationModel.markAllAsRead(userId);
};

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Extract a human-readable rejection reason from moderation_notes or a plain string.
 * Priority: 1) string as-is, 2) rejection_reason key, 3) first "rejected:" field value.
 */
const extractRejectionReason = (reason) => {
  if (!reason) return null;
  if (typeof reason === 'string') return reason;
  if (typeof reason === 'object') {
    if (reason.rejection_reason) return reason.rejection_reason;
    for (const value of Object.values(reason)) {
      if (typeof value === 'string' && value.toLowerCase().startsWith('rejected:')) {
        return value.replace(/^rejected:\s*/i, '').trim();
      }
    }
  }
  return null;
};

// ============================================================================
// Trigger helpers (NON-BLOCKING — called without await from other services)
// ============================================================================

/**
 * Notify partner about establishment status change
 * Called after: moderateEstablishment, suspendEstablishment, unsuspendEstablishment
 *
 * @param {string} establishmentId
 * @param {string} newStatus - 'active' | 'rejected' | 'suspended' | 'unsuspended'
 * @param {string|object} [reason] - Rejection/suspension reason (string or moderation_notes object)
 */
export const notifyEstablishmentStatusChange = async (establishmentId, newStatus, reason) => {
  try {
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
    if (!establishment || !establishment.partner_id) return;

    const typeMap = {
      active: 'establishment_approved',
      rejected: 'establishment_rejected',
      suspended: 'establishment_suspended',
      unsuspended: 'establishment_unsuspended',
    };

    const type = typeMap[newStatus];
    if (!type) return;

    const name = establishment.name || 'Заведение';
    let message;

    if (type === 'establishment_approved') {
      message = `«${name}» одобрено модерацией`;
    } else if (type === 'establishment_rejected') {
      const parsed = extractRejectionReason(reason);
      message = parsed
        ? `«${name}» отклонено: ${parsed}`
        : `«${name}» отклонено модерацией`;
    } else if (type === 'establishment_suspended') {
      message = reason
        ? `«${name}» приостановлено: ${reason}`
        : `«${name}» приостановлено модерацией`;
    } else if (type === 'establishment_unsuspended') {
      message = `«${name}» снова активно`;
    }

    await NotificationModel.create({
      userId: establishment.partner_id,
      type,
      title: TITLES[type],
      message,
      establishmentId,
    });
  } catch (error) {
    logger.error('Failed to create establishment status notification', {
      error: error.message,
      establishmentId,
      newStatus,
    });
  }
};

/**
 * Notify partner about a new review on their establishment
 * Called after: createReview
 *
 * @param {string} reviewId
 * @param {string} establishmentId
 */
export const notifyNewReview = async (reviewId, establishmentId) => {
  try {
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
    if (!establishment || !establishment.partner_id) return;

    const name = establishment.name || 'Заведение';

    await NotificationModel.create({
      userId: establishment.partner_id,
      type: 'new_review',
      title: TITLES.new_review,
      message: `Новый отзыв на «${name}»`,
      establishmentId,
      reviewId,
    });
  } catch (error) {
    logger.error('Failed to create new review notification', {
      error: error.message,
      reviewId,
      establishmentId,
    });
  }
};

/**
 * Notify review author about a partner response
 * Called after: addPartnerResponse
 *
 * @param {string} reviewId
 * @param {string} establishmentId
 */
export const notifyPartnerResponse = async (reviewId, establishmentId) => {
  try {
    const review = await ReviewModel.findReviewById(reviewId);
    if (!review || !review.user_id) return;

    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
    const name = establishment ? (establishment.name || 'Заведение') : 'Заведение';

    await NotificationModel.create({
      userId: review.user_id,
      type: 'partner_response',
      title: TITLES.partner_response,
      message: `Владелец «${name}» ответил на ваш отзыв`,
      establishmentId,
      reviewId,
    });
  } catch (error) {
    logger.error('Failed to create partner response notification', {
      error: error.message,
      reviewId,
      establishmentId,
    });
  }
};

/**
 * Notify review author about moderation action (hide/delete)
 * Called after: toggleVisibility (hide only), deleteReview
 *
 * @param {string} reviewId
 * @param {'hidden'|'deleted'} action
 */
export const notifyReviewModerated = async (reviewId, action) => {
  try {
    const review = await ReviewModel.findReviewById(reviewId);
    if (!review || !review.user_id) return;

    const type = action === 'hidden' ? 'review_hidden' : 'review_deleted';

    const establishment = await EstablishmentModel.findEstablishmentById(
      review.establishment_id,
      true,
    );
    const name = establishment ? (establishment.name || 'Заведение') : 'Заведение';

    const message = action === 'hidden'
      ? `Ваш отзыв на «${name}» скрыт модератором`
      : `Ваш отзыв на «${name}» удалён модератором`;

    await NotificationModel.create({
      userId: review.user_id,
      type,
      title: TITLES[type],
      message,
      establishmentId: review.establishment_id,
      reviewId,
    });
  } catch (error) {
    logger.error('Failed to create review moderation notification', {
      error: error.message,
      reviewId,
      action,
    });
  }
};

/**
 * Notify new partner that an establishment has been claimed for them
 * Called after: adminService.claimEstablishment
 *
 * @param {string} establishmentId
 * @param {string} newPartnerId - UUID of the new owner
 */
export const notifyEstablishmentClaimed = async (establishmentId, newPartnerId) => {
  try {
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
    if (!establishment) return;

    const name = establishment.name || 'Заведение';

    await NotificationModel.create({
      userId: newPartnerId,
      type: 'establishment_claimed',
      title: TITLES.establishment_claimed,
      message: `«${name}» добавлено в ваш кабинет`,
      establishmentId,
    });
  } catch (error) {
    logger.error('Failed to create establishment claimed notification', {
      error: error.message,
      establishmentId,
      newPartnerId,
    });
  }
};

// ============================================================================
// Booking notification helpers (NON-BLOCKING)
// ============================================================================

/**
 * Format booking date/time for human-readable notification messages.
 * Handles ISO "2026-04-07T00:00:00.000Z" → "7 апреля", time "21:00:00" → "21:00"
 */
const MONTHS_RU = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const formatBookingDateTime = (dateStr, timeStr) => {
  let formattedDate = dateStr;
  try {
    const dt = new Date(dateStr);
    if (!isNaN(dt.getTime())) {
      formattedDate = `${dt.getUTCDate()} ${MONTHS_RU[dt.getUTCMonth() + 1]}`;
    }
  } catch (_) { /* keep raw */ }

  // Strip seconds: "21:00:00" → "21:00"
  const formattedTime = timeStr ? timeStr.split(':').slice(0, 2).join(':') : timeStr;

  return { date: formattedDate, time: formattedTime };
};

/**
 * Notify partner about a new booking request.
 *
 * @param {string} partnerId
 * @param {object} bookingData - { id, establishment_name, user_name, booking_date, booking_time, guest_count }
 * @param {string} establishmentId
 */
export const notifyBookingReceived = async (partnerId, bookingData, establishmentId) => {
  try {
    const name = bookingData.establishment_name || 'Заведение';
    const { date, time } = formatBookingDateTime(bookingData.booking_date, bookingData.booking_time);
    await NotificationModel.create({
      userId: partnerId,
      type: 'booking_received',
      title: TITLES.booking_received,
      message: `Новая бронь на «${name}» — ${bookingData.guest_count} гост., ${date} ${time}`,
      establishmentId,
    });
  } catch (error) {
    logger.error('Failed to create booking received notification', {
      error: error.message,
      partnerId,
      establishmentId,
    });
  }
};

/**
 * Notify user that their booking is confirmed.
 *
 * @param {string} userId
 * @param {object} bookingData
 * @param {string} establishmentId
 */
export const notifyBookingConfirmed = async (userId, bookingData, establishmentId) => {
  try {
    const name = bookingData.establishment_name || 'Заведение';
    const { date, time } = formatBookingDateTime(bookingData.booking_date, bookingData.booking_time);
    await NotificationModel.create({
      userId,
      type: 'booking_confirmed',
      title: TITLES.booking_confirmed,
      message: `Ваша бронь на «${name}» подтверждена — ${date} ${time}`,
      establishmentId,
    });
  } catch (error) {
    logger.error('Failed to create booking confirmed notification', {
      error: error.message,
      userId,
      establishmentId,
    });
  }
};

/**
 * Notify user that their booking was declined.
 *
 * @param {string} userId
 * @param {object} bookingData
 * @param {string} establishmentId
 * @param {string} reason
 */
export const notifyBookingDeclined = async (userId, bookingData, establishmentId, reason) => {
  try {
    const name = bookingData.establishment_name || 'Заведение';
    const { date, time } = formatBookingDateTime(bookingData.booking_date, bookingData.booking_time);
    const msg = reason
      ? `Бронь на «${name}» (${date} ${time}) отклонена: ${reason}`
      : `Бронь на «${name}» (${date} ${time}) отклонена`;
    await NotificationModel.create({
      userId,
      type: 'booking_declined',
      title: TITLES.booking_declined,
      message: msg,
      establishmentId,
    });
  } catch (error) {
    logger.error('Failed to create booking declined notification', {
      error: error.message,
      userId,
      establishmentId,
    });
  }
};

/**
 * Notify BOTH user and partner that a booking expired.
 *
 * @param {string} userId
 * @param {string} partnerId
 * @param {object} bookingData
 * @param {string} establishmentId
 */
export const notifyBookingExpired = async (userId, partnerId, bookingData, establishmentId) => {
  try {
    const name = bookingData.establishment_name || 'Заведение';
    const { date, time } = formatBookingDateTime(bookingData.booking_date, bookingData.booking_time);
    const msg = `Бронь на «${name}» (${date} ${time}) истекла`;

    // Notify user
    await NotificationModel.create({
      userId,
      type: 'booking_expired',
      title: TITLES.booking_expired,
      message: msg,
      establishmentId,
    });

    // Notify partner
    await NotificationModel.create({
      userId: partnerId,
      type: 'booking_expired',
      title: TITLES.booking_expired,
      message: msg,
      establishmentId,
    });
  } catch (error) {
    logger.error('Failed to create booking expired notifications', {
      error: error.message,
      userId,
      partnerId,
      establishmentId,
    });
  }
};

/**
 * Notify partner that user cancelled a booking.
 *
 * @param {string} partnerId
 * @param {object} bookingData
 * @param {string} establishmentId
 */
export const notifyBookingCancelled = async (partnerId, bookingData, establishmentId) => {
  try {
    const name = bookingData.establishment_name || 'Заведение';
    const { date, time } = formatBookingDateTime(bookingData.booking_date, bookingData.booking_time);
    await NotificationModel.create({
      userId: partnerId,
      type: 'booking_cancelled',
      title: TITLES.booking_cancelled,
      message: `Бронь на «${name}» (${date} ${time}) отменена гостем`,
      establishmentId,
    });
  } catch (error) {
    logger.error('Failed to create booking cancelled notification', {
      error: error.message,
      partnerId,
      establishmentId,
    });
  }
};
