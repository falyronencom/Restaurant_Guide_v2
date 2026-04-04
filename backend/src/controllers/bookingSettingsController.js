/**
 * Booking Settings Controller
 *
 * HTTP handlers for partner booking settings endpoints.
 * Thin layer: extracts params, delegates to bookingSettingsService, formats response.
 */

import * as BookingSettingsService from '../services/bookingSettingsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * GET /api/v1/partner/booking-settings/:establishmentId
 * Get current booking settings (or null if not activated).
 */
export const getSettings = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId } = req.params;

  const settings = await BookingSettingsService.getSettings(establishmentId, partnerId);

  res.status(200).json({
    success: true,
    data: settings,
  });
});

/**
 * POST /api/v1/partner/booking-settings/:establishmentId/activate
 * Activate booking (create settings + enable).
 */
export const activate = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId } = req.params;
  const {
    max_guests_per_booking,
    confirmation_timeout_hours,
    max_days_ahead,
    min_hours_before,
  } = req.body;

  const settings = await BookingSettingsService.activate(establishmentId, partnerId, {
    maxGuestsPerBooking: max_guests_per_booking,
    confirmationTimeoutHours: confirmation_timeout_hours,
    maxDaysAhead: max_days_ahead,
    minHoursBefore: min_hours_before,
  });

  logger.info('Booking settings activated via API', {
    establishmentId,
    partnerId,
    endpoint: 'POST /api/v1/partner/booking-settings/:id/activate',
  });

  res.status(201).json({
    success: true,
    data: settings,
  });
});

/**
 * PUT /api/v1/partner/booking-settings/:establishmentId
 * Update booking settings.
 */
export const updateSettings = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId } = req.params;
  const {
    max_guests_per_booking,
    confirmation_timeout_hours,
    max_days_ahead,
    min_hours_before,
  } = req.body;

  const settings = await BookingSettingsService.updateSettings(establishmentId, partnerId, {
    maxGuestsPerBooking: max_guests_per_booking,
    confirmationTimeoutHours: confirmation_timeout_hours,
    maxDaysAhead: max_days_ahead,
    minHoursBefore: min_hours_before,
  });

  res.status(200).json({
    success: true,
    data: settings,
  });
});

/**
 * POST /api/v1/partner/booking-settings/:establishmentId/deactivate
 * Disable booking.
 */
export const deactivate = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId } = req.params;

  const settings = await BookingSettingsService.deactivate(establishmentId, partnerId);

  logger.info('Booking settings deactivated via API', {
    establishmentId,
    partnerId,
    endpoint: 'POST /api/v1/partner/booking-settings/:id/deactivate',
  });

  res.status(200).json({
    success: true,
    data: settings,
  });
});
