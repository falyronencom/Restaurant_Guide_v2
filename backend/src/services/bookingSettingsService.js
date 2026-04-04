/**
 * Booking Settings Service
 *
 * Business logic for booking settings management.
 * activate/deactivate use transactions to keep booking_settings.is_enabled
 * and establishments.booking_enabled in sync.
 */

import * as BookingSettingsModel from '../models/bookingSettingsModel.js';
import { getClient } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import * as PartnerAnalyticsModel from '../models/partnerAnalyticsModel.js';
import logger from '../utils/logger.js';

// Allowed values for settings fields
const ALLOWED_TIMEOUT_HOURS = [2, 4, 6];
const ALLOWED_MAX_DAYS_AHEAD = [0, 1, 3, 7, 14, 30];
const ALLOWED_MIN_HOURS_BEFORE = [1, 2, 3, 6, 12, 24];

/**
 * Validate settings fields.
 */
const validateSettings = (data) => {
  const { maxGuestsPerBooking, confirmationTimeoutHours, maxDaysAhead, minHoursBefore } = data;

  if (maxGuestsPerBooking !== undefined && maxGuestsPerBooking < 1) {
    throw new AppError('max_guests_per_booking must be >= 1', 400, 'VALIDATION_ERROR');
  }

  if (confirmationTimeoutHours !== undefined && !ALLOWED_TIMEOUT_HOURS.includes(confirmationTimeoutHours)) {
    throw new AppError(
      `confirmation_timeout_hours must be one of: ${ALLOWED_TIMEOUT_HOURS.join(', ')}`,
      400,
      'VALIDATION_ERROR',
    );
  }

  if (maxDaysAhead !== undefined && !ALLOWED_MAX_DAYS_AHEAD.includes(maxDaysAhead)) {
    throw new AppError(
      `max_days_ahead must be one of: ${ALLOWED_MAX_DAYS_AHEAD.join(', ')}`,
      400,
      'VALIDATION_ERROR',
    );
  }

  if (minHoursBefore !== undefined && !ALLOWED_MIN_HOURS_BEFORE.includes(minHoursBefore)) {
    throw new AppError(
      `min_hours_before must be one of: ${ALLOWED_MIN_HOURS_BEFORE.join(', ')}`,
      400,
      'VALIDATION_ERROR',
    );
  }
};

/**
 * Get booking settings for an establishment.
 *
 * @param {string} establishmentId
 * @param {string} partnerId - for ownership verification
 * @returns {object|null}
 */
export const getSettings = async (establishmentId, partnerId) => {
  await verifyOwnership(establishmentId, partnerId);
  return BookingSettingsModel.getByEstablishmentId(establishmentId);
};

/**
 * Activate booking for an establishment.
 * Creates settings row + sets establishments.booking_enabled = TRUE in one transaction.
 *
 * @param {string} establishmentId
 * @param {string} partnerId
 * @param {object} settings - optional settings overrides
 * @returns {object} created settings row
 */
export const activate = async (establishmentId, partnerId, settings = {}) => {
  await verifyOwnership(establishmentId, partnerId);

  const data = {
    establishmentId,
    isEnabled: true,
    maxGuestsPerBooking: settings.maxGuestsPerBooking ?? 10,
    confirmationTimeoutHours: settings.confirmationTimeoutHours ?? 4,
    maxDaysAhead: settings.maxDaysAhead ?? 7,
    minHoursBefore: settings.minHoursBefore ?? 2,
  };

  validateSettings(data);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const result = await BookingSettingsModel.createOrUpdate(data, client);

    await client.query(
      'UPDATE establishments SET booking_enabled = TRUE, updated_at = NOW() WHERE id = $1',
      [establishmentId],
    );

    await client.query('COMMIT');

    logger.info('Booking activated for establishment', { establishmentId, partnerId });
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Booking activation transaction failed', {
      error: err.message,
      establishmentId,
    });
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Deactivate booking for an establishment.
 * Sets is_enabled = FALSE + booking_enabled = FALSE. Existing confirmed bookings preserved.
 *
 * @param {string} establishmentId
 * @param {string} partnerId
 * @returns {object} updated settings
 */
export const deactivate = async (establishmentId, partnerId) => {
  await verifyOwnership(establishmentId, partnerId);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const result = await BookingSettingsModel.updateEnabled(establishmentId, false, client);

    if (!result) {
      throw new AppError('Booking settings not found', 404, 'NOT_FOUND');
    }

    await client.query(
      'UPDATE establishments SET booking_enabled = FALSE, updated_at = NOW() WHERE id = $1',
      [establishmentId],
    );

    await client.query('COMMIT');

    logger.info('Booking deactivated for establishment', { establishmentId, partnerId });
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof AppError) throw err;
    logger.error('Booking deactivation transaction failed', {
      error: err.message,
      establishmentId,
    });
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Update booking settings (without changing enabled state).
 *
 * @param {string} establishmentId
 * @param {string} partnerId
 * @param {object} updates
 * @returns {object} updated settings
 */
export const updateSettings = async (establishmentId, partnerId, updates) => {
  await verifyOwnership(establishmentId, partnerId);

  const existing = await BookingSettingsModel.getByEstablishmentId(establishmentId);
  if (!existing) {
    throw new AppError('Booking settings not found. Activate booking first.', 404, 'NOT_FOUND');
  }

  const data = {
    establishmentId,
    isEnabled: existing.is_enabled,
    maxGuestsPerBooking: updates.maxGuestsPerBooking ?? existing.max_guests_per_booking,
    confirmationTimeoutHours: updates.confirmationTimeoutHours ?? existing.confirmation_timeout_hours,
    maxDaysAhead: updates.maxDaysAhead ?? existing.max_days_ahead,
    minHoursBefore: updates.minHoursBefore ?? existing.min_hours_before,
  };

  validateSettings(data);

  return BookingSettingsModel.createOrUpdate(data);
};

/**
 * Verify that establishment belongs to partner.
 */
const verifyOwnership = async (establishmentId, partnerId) => {
  const owned = await PartnerAnalyticsModel.verifyOwnership(establishmentId, partnerId);
  if (!owned) {
    throw new AppError('Establishment not found or not owned by you', 403, 'FORBIDDEN');
  }
};
