/**
 * Booking Controller
 *
 * HTTP handlers for booking endpoints, split by audience:
 * - Partner: list, confirm, decline, no-show, complete
 * - User: create, list, cancel
 */

import * as BookingService from '../services/bookingService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

// ============================================================================
// Partner endpoints
// ============================================================================

/**
 * GET /api/v1/partner/bookings/:establishmentId
 * List bookings for establishment (optional status filter).
 */
export const getPartnerBookings = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId } = req.params;
  const { status, limit, offset } = req.query;

  const result = await BookingService.getPartnerBookings(establishmentId, partnerId, {
    status,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * PUT /api/v1/partner/bookings/:establishmentId/:bookingId/confirm
 */
export const confirmBooking = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId, bookingId } = req.params;

  const booking = await BookingService.confirmBooking(bookingId, partnerId, establishmentId);

  logger.info('Booking confirmed via API', {
    bookingId,
    establishmentId,
    partnerId,
  });

  res.status(200).json({
    success: true,
    data: booking,
  });
});

/**
 * PUT /api/v1/partner/bookings/:establishmentId/:bookingId/decline
 */
export const declineBooking = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId, bookingId } = req.params;
  const { reason } = req.body;

  const booking = await BookingService.declineBooking(bookingId, partnerId, establishmentId, reason);

  logger.info('Booking declined via API', {
    bookingId,
    establishmentId,
    partnerId,
  });

  res.status(200).json({
    success: true,
    data: booking,
  });
});

/**
 * PUT /api/v1/partner/bookings/:establishmentId/:bookingId/no-show
 */
export const markNoShow = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId, bookingId } = req.params;

  const booking = await BookingService.markNoShow(bookingId, partnerId, establishmentId);

  res.status(200).json({
    success: true,
    data: booking,
  });
});

/**
 * PUT /api/v1/partner/bookings/:establishmentId/:bookingId/complete
 */
export const markCompleted = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId, bookingId } = req.params;

  const booking = await BookingService.markCompleted(bookingId, partnerId, establishmentId);

  res.status(200).json({
    success: true,
    data: booking,
  });
});

// ============================================================================
// User endpoints
// ============================================================================

/**
 * POST /api/v1/bookings
 * Create a new booking.
 */
export const createBooking = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const {
    establishmentId,
    date,
    time,
    guestCount,
    comment,
    contactPhone,
  } = req.body;

  const booking = await BookingService.createBooking(userId, {
    establishmentId,
    date,
    time,
    guestCount: guestCount ? parseInt(guestCount, 10) : undefined,
    comment,
    contactPhone,
  });

  res.status(201).json({
    success: true,
    data: booking,
  });
});

/**
 * GET /api/v1/bookings/my
 * List current user's bookings.
 */
export const getUserBookings = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const bookings = await BookingService.getUserBookings(userId);

  res.status(200).json({
    success: true,
    data: bookings,
  });
});

/**
 * PUT /api/v1/bookings/:bookingId/cancel
 * Cancel a confirmed booking.
 */
export const cancelBooking = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { bookingId } = req.params;

  const booking = await BookingService.cancelBooking(bookingId, userId);

  logger.info('Booking cancelled via API', {
    bookingId,
    userId,
  });

  res.status(200).json({
    success: true,
    data: booking,
  });
});
