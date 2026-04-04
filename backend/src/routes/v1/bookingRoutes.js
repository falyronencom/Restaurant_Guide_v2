/**
 * Booking Routes
 *
 * Split by audience:
 *
 * Partner routes (under /api/v1/partner/bookings/:establishmentId):
 *   GET    /                          — list bookings (status filter)
 *   PUT    /:bookingId/confirm        — confirm booking
 *   PUT    /:bookingId/decline        — decline booking
 *   PUT    /:bookingId/no-show        — mark no-show
 *   PUT    /:bookingId/complete       — mark completed
 *
 * User routes (under /api/v1/bookings):
 *   POST   /                          — create booking
 *   GET    /my                        — list user's bookings
 *   PUT    /:bookingId/cancel         — cancel booking
 *
 * Partner routes require partner auth. User routes require user auth.
 */

import express from 'express';
import * as BookingController from '../../controllers/bookingController.js';
import { authenticate, authorize } from '../../middleware/auth.js';

// ============================================================================
// Partner booking routes
// ============================================================================

export const partnerBookingRouter = express.Router();

partnerBookingRouter.use(authenticate);
partnerBookingRouter.use(authorize('partner'));

partnerBookingRouter.get(
  '/:establishmentId',
  BookingController.getPartnerBookings,
);

partnerBookingRouter.put(
  '/:establishmentId/:bookingId/confirm',
  BookingController.confirmBooking,
);

partnerBookingRouter.put(
  '/:establishmentId/:bookingId/decline',
  BookingController.declineBooking,
);

partnerBookingRouter.put(
  '/:establishmentId/:bookingId/no-show',
  BookingController.markNoShow,
);

partnerBookingRouter.put(
  '/:establishmentId/:bookingId/complete',
  BookingController.markCompleted,
);

// ============================================================================
// User booking routes
// ============================================================================

export const userBookingRouter = express.Router();

userBookingRouter.use(authenticate);

userBookingRouter.post(
  '/',
  BookingController.createBooking,
);

userBookingRouter.get(
  '/my',
  BookingController.getUserBookings,
);

userBookingRouter.put(
  '/:bookingId/cancel',
  BookingController.cancelBooking,
);
