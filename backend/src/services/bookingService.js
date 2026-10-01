/**
 * Booking Service
 *
 * Business logic for booking lifecycle:
 * create → confirm/decline/expire → cancel/no_show/complete
 *
 * Validates: user limits, establishment settings, working hours, time constraints.
 * Integrates: notifications (non-blocking), analytics tracking.
 */

import * as BookingModel from '../models/bookingModel.js';
import * as BookingSettingsModel from '../models/bookingSettingsModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as PartnerAnalyticsModel from '../models/partnerAnalyticsModel.js';
import * as NotificationService from './notificationService.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

// ============================================================================
// Working hours validation (handles both string and object formats)
// ============================================================================

// Map JS getDay() (0=Sun) to working_hours keys
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Parse working hours for a specific day, handling both formats:
 * - String: "09:00-22:00"
 * - Object: { is_open: true, open: "09:00", close: "22:00" }
 *
 * @param {object} workingHours - JSONB from establishments
 * @param {string} dayKey - e.g. "monday"
 * @returns {{ isOpen: boolean, open: string|null, close: string|null }}
 */
const parseDayHours = (workingHours, dayKey) => {
  if (!workingHours || !workingHours[dayKey]) {
    return { isOpen: false, open: null, close: null };
  }

  const value = workingHours[dayKey];

  if (typeof value === 'string') {
    // Format: "09:00-22:00"
    const parts = value.split('-');
    if (parts.length === 2) {
      return { isOpen: true, open: parts[0].trim(), close: parts[1].trim() };
    }
    return { isOpen: false, open: null, close: null };
  }

  if (typeof value === 'object') {
    // Format: { is_open: true/false, open: "09:00", close: "22:00" }
    if (value.is_open === false) {
      return { isOpen: false, open: null, close: null };
    }
    return {
      isOpen: true,
      open: value.open || null,
      close: value.close || null,
    };
  }

  return { isOpen: false, open: null, close: null };
};

/**
 * Check if a time string "HH:MM" falls within open-close range.
 */
const isTimeWithinRange = (time, open, close) => {
  if (!open || !close) return true; // No hours specified = accept
  return time >= open && time <= close;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'YYYY-MM-DD' of a day that exists (2026-02-30 does not). */
const isCalendarDate = (value) => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
};

// ============================================================================
// Ownership (partner actions)
// ============================================================================

/**
 * The establishment in the URL belongs to the partner, or 403.
 *
 * The partner routes check only the role (bookingRoutes.js), so this is the
 * whole ownership check — and it runs FIRST, before the booking is looked up or
 * its status read. Otherwise a foreign partner would learn from the different
 * codes and texts whether a booking exists and in which status it is. Same code
 * and text as bookingSettingsService.verifyOwnership.
 */
const assertOwnsEstablishment = async (establishmentId, partnerId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError('Establishment not found or not owned by you', 403, 'FORBIDDEN');
  }
};

// ============================================================================
// Booking CRUD
// ============================================================================

/**
 * Create a new booking.
 *
 * Validates all constraints from the directive:
 * - user authorized, has phone
 * - booking_enabled for establishment
 * - guest_count <= max_guests_per_booking
 * - booking_date within max_days_ahead
 * - booking_time within working_hours
 * - min_hours_before respected
 * - user active bookings < 2
 * - user has no active booking at this establishment
 *
 * Date and time are Minsk wall clock. "Today", the weekday and the hours left
 * until the slot are computed in SQL on the Minsk clock, and the confirmation
 * deadline from NOW() — never from the process clock: production runs UTC, CI
 * runs Europe/Minsk, and the old arithmetic on JS Dates accepted a slot that
 * had already passed (external review 23.09.2026, #35).
 *
 * @param {string} userId
 * @param {object} data - { establishmentId, date 'YYYY-MM-DD', time 'HH:MM', guestCount, comment, contactPhone }
 * @param {object} [options]
 * @param {Date} [options.now] - injectable clock for tests; production passes
 *   nothing and the database clock (NOW()) decides. Not reachable over HTTP.
 */
export const createBooking = async (userId, data, { now = null } = {}) => {
  const {
    establishmentId,
    date: bookingDate,
    time: bookingTime,
    guestCount,
    comment,
    contactPhone,
  } = data;

  // 1. Validate required fields
  if (!establishmentId || !bookingDate || !bookingTime || !guestCount || !contactPhone) {
    throw new AppError(
      'Необходимо заполнить все обязательные поля',
      400,
      'VALIDATION_ERROR',
    );
  }
  // The date and time go into SQL as ::date / ::time, where a malformed string
  // would surface as a 500. Clients send zero-padded 'YYYY-MM-DD' and 'HH:MM'.
  if (!isCalendarDate(bookingDate) || !TIME_RE.test(bookingTime)) {
    throw new AppError(
      'Неверный формат даты или времени бронирования',
      400,
      'VALIDATION_ERROR',
    );
  }

  // 2. Get establishment and verify booking is enabled
  const establishment = await EstablishmentModel.findEstablishmentById(establishmentId);
  if (!establishment) {
    throw new AppError('Заведение не найдено', 404, 'NOT_FOUND');
  }
  if (establishment.status !== 'active') {
    throw new AppError('Заведение неактивно', 400, 'ESTABLISHMENT_NOT_ACTIVE');
  }

  // 3. Get booking settings
  const settings = await BookingSettingsModel.getByEstablishmentId(establishmentId);
  if (!settings || !settings.is_enabled) {
    throw new AppError('Бронирование недоступно для этого заведения', 400, 'BOOKING_NOT_ENABLED');
  }

  // 4. Validate guest count
  if (guestCount < 1 || guestCount > settings.max_guests_per_booking) {
    throw new AppError(
      `Количество гостей должно быть от 1 до ${settings.max_guests_per_booking}`,
      400,
      'INVALID_GUEST_COUNT',
    );
  }

  // 5–7 run on one Minsk-clock reading of the slot (BookingModel.checkSlot).
  const slot = await BookingModel.checkSlot({
    bookingDate,
    bookingTime,
    maxDaysAhead: settings.max_days_ahead,
    now,
  });

  // 5. Validate booking date (within max_days_ahead)
  if (slot.isPastDate) {
    throw new AppError('Дата бронирования не может быть в прошлом', 400, 'INVALID_DATE');
  }

  if (slot.isTooFar) {
    throw new AppError(
      `Бронирование возможно не более чем на ${settings.max_days_ahead} дней вперёд`,
      400,
      'DATE_TOO_FAR',
    );
  }

  // 6. Validate booking time within working hours
  const dayKey = DAY_KEYS[slot.dayOfWeek]; // 0=Sun
  const dayHours = parseDayHours(establishment.working_hours, dayKey);

  if (!dayHours.isOpen) {
    throw new AppError('Заведение не работает в выбранный день', 400, 'CLOSED_DAY');
  }

  if (!isTimeWithinRange(bookingTime, dayHours.open, dayHours.close)) {
    throw new AppError(
      `Время бронирования должно быть в рабочие часы (${dayHours.open}-${dayHours.close})`,
      400,
      'TIME_OUTSIDE_HOURS',
    );
  }

  // 7. Validate min_hours_before
  if (slot.hoursUntil < settings.min_hours_before) {
    throw new AppError(
      `Бронирование должно быть сделано минимум за ${settings.min_hours_before} ч.`,
      400,
      'TOO_LATE',
    );
  }

  // 8. Check user limits
  const activeCount = await BookingModel.getActiveCountForUser(userId);
  if (activeCount >= 2) {
    throw new AppError(
      'У вас уже 2 активных бронирования. Отмените существующее или дождитесь его завершения.',
      400,
      'MAX_BOOKINGS_REACHED',
    );
  }

  const existingAtEstablishment = await BookingModel.getActiveForEstablishmentAndUser(
    userId,
    establishmentId,
  );
  if (existingAtEstablishment) {
    throw new AppError(
      'У вас уже есть активное бронирование в этом заведении',
      400,
      'DUPLICATE_BOOKING',
    );
  }

  // 9–10. Create booking; expires_at = now + confirmation timeout, in SQL
  const booking = await BookingModel.create({
    establishmentId,
    userId,
    bookingDate,
    bookingTime,
    guestCount,
    comment,
    contactPhone,
    confirmationTimeoutHours: settings.confirmation_timeout_hours,
    now,
  });

  // 11. Track analytics (non-blocking)
  PartnerAnalyticsModel.trackBookingRequest(establishmentId).catch(() => {});

  // 12. Notify partner (non-blocking)
  NotificationService.notifyBookingReceived(
    establishment.partner_id,
    {
      establishment_name: establishment.name,
      user_name: null,
      booking_date: bookingDate,
      booking_time: bookingTime,
      guest_count: guestCount,
    },
    establishmentId,
  ).catch(() => {});

  logger.info('Booking created', {
    bookingId: booking.id,
    establishmentId,
    userId,
  });

  return booking;
};

/**
 * Confirm a booking (partner action).
 * Transition: pending → confirmed
 */
export const confirmBooking = async (bookingId, partnerId, establishmentId) => {
  await assertOwnsEstablishment(establishmentId, partnerId);

  const booking = await BookingModel.getById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404, 'NOT_FOUND');
  }
  if (booking.establishment_id !== establishmentId) {
    throw new AppError('Booking does not belong to this establishment', 403, 'FORBIDDEN');
  }
  if (booking.status !== 'pending') {
    throw new AppError(`Cannot confirm booking with status '${booking.status}'`, 400, 'INVALID_STATUS');
  }

  const updated = await BookingModel.updateStatus(bookingId, {
    status: 'confirmed',
    confirmedAt: new Date(),
  });

  // Track analytics (non-blocking)
  PartnerAnalyticsModel.trackBookingConfirmed(establishmentId).catch(() => {});

  // Notify user (non-blocking)
  NotificationService.notifyBookingConfirmed(
    booking.user_id,
    {
      establishment_name: booking.establishment_name,
      booking_date: booking.booking_date,
      booking_time: booking.booking_time,
    },
    establishmentId,
  ).catch(() => {});

  logger.info('Booking confirmed', { bookingId, establishmentId });
  return updated;
};

/**
 * Decline a booking (partner action).
 * Transition: pending → declined
 */
export const declineBooking = async (bookingId, partnerId, establishmentId, reason) => {
  await assertOwnsEstablishment(establishmentId, partnerId);

  if (!reason || !reason.trim()) {
    throw new AppError('Decline reason is required', 400, 'VALIDATION_ERROR');
  }

  const booking = await BookingModel.getById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404, 'NOT_FOUND');
  }
  if (booking.establishment_id !== establishmentId) {
    throw new AppError('Booking does not belong to this establishment', 403, 'FORBIDDEN');
  }
  if (booking.status !== 'pending') {
    throw new AppError(`Cannot decline booking with status '${booking.status}'`, 400, 'INVALID_STATUS');
  }

  const updated = await BookingModel.updateStatus(bookingId, {
    status: 'declined',
    declineReason: reason.trim(),
  });

  // Notify user (non-blocking)
  NotificationService.notifyBookingDeclined(
    booking.user_id,
    {
      establishment_name: booking.establishment_name,
      booking_date: booking.booking_date,
      booking_time: booking.booking_time,
    },
    establishmentId,
    reason.trim(),
  ).catch(() => {});

  logger.info('Booking declined', { bookingId, establishmentId, reason });
  return updated;
};

/**
 * Cancel a booking (user action).
 * Transition: confirmed → cancelled
 */
export const cancelBooking = async (bookingId, userId) => {
  const booking = await BookingModel.getById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404, 'NOT_FOUND');
  }
  if (booking.user_id !== userId) {
    throw new AppError('This booking does not belong to you', 403, 'FORBIDDEN');
  }
  if (booking.status !== 'confirmed') {
    throw new AppError(`Cannot cancel booking with status '${booking.status}'`, 400, 'INVALID_STATUS');
  }

  const updated = await BookingModel.updateStatus(bookingId, {
    status: 'cancelled',
    cancelledAt: new Date(),
  });

  // Get establishment for partner notification
  const establishment = await EstablishmentModel.findEstablishmentById(booking.establishment_id, true);

  // Notify partner (non-blocking)
  if (establishment && establishment.partner_id) {
    NotificationService.notifyBookingCancelled(
      establishment.partner_id,
      {
        establishment_name: booking.establishment_name,
        booking_date: booking.booking_date,
        booking_time: booking.booking_time,
      },
      booking.establishment_id,
    ).catch(() => {});
  }

  logger.info('Booking cancelled by user', { bookingId, userId });
  return updated;
};

/**
 * Mark booking as no-show (partner action).
 * Transition: confirmed → no_show
 */
export const markNoShow = async (bookingId, partnerId, establishmentId) => {
  await assertOwnsEstablishment(establishmentId, partnerId);

  const booking = await BookingModel.getById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404, 'NOT_FOUND');
  }
  if (booking.establishment_id !== establishmentId) {
    throw new AppError('Booking does not belong to this establishment', 403, 'FORBIDDEN');
  }
  if (booking.status !== 'confirmed') {
    throw new AppError(`Cannot mark no-show for booking with status '${booking.status}'`, 400, 'INVALID_STATUS');
  }

  const updated = await BookingModel.updateStatus(bookingId, { status: 'no_show' });
  logger.info('Booking marked as no-show', { bookingId, establishmentId });
  return updated;
};

/**
 * Mark booking as completed (partner action).
 * Transition: confirmed → completed
 */
export const markCompleted = async (bookingId, partnerId, establishmentId) => {
  await assertOwnsEstablishment(establishmentId, partnerId);

  const booking = await BookingModel.getById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404, 'NOT_FOUND');
  }
  if (booking.establishment_id !== establishmentId) {
    throw new AppError('Booking does not belong to this establishment', 403, 'FORBIDDEN');
  }
  if (booking.status !== 'confirmed') {
    throw new AppError(`Cannot complete booking with status '${booking.status}'`, 400, 'INVALID_STATUS');
  }

  const updated = await BookingModel.updateStatus(bookingId, { status: 'completed' });
  logger.info('Booking marked as completed', { bookingId, establishmentId });
  return updated;
};

/**
 * Get bookings for an establishment (partner view).
 * Ownership first: the read also runs the lazy expiry of this establishment's
 * pending bookings (bookingModel.getByEstablishmentId), a write.
 */
export const getPartnerBookings = async (establishmentId, partnerId, options = {}) => {
  await assertOwnsEstablishment(establishmentId, partnerId);
  return BookingModel.getByEstablishmentId(establishmentId, options);
};

/**
 * Get bookings for a user.
 */
export const getUserBookings = async (userId) => {
  return BookingModel.getByUserId(userId);
};
