/**
 * Booking Settings Model
 *
 * CRUD operations for the booking_settings table.
 * One row per establishment — UPSERT pattern for createOrUpdate.
 *
 * Tables: booking_settings
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Get booking settings for an establishment.
 *
 * @param {string} establishmentId - UUID
 * @param {object} [client] - optional DB client for transactions
 * @returns {object|null} settings row or null
 */
export const getByEstablishmentId = async (establishmentId, client) => {
  const queryExecutor = client || pool;
  const query = `
    SELECT * FROM booking_settings
    WHERE establishment_id = $1
  `;
  try {
    const result = await queryExecutor.query(query, [establishmentId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting booking settings', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * The booking terms a guest's form needs — only for an active establishment
 * whose booking is switched on, the same two conditions createBooking checks
 * (bookingService.createBooking, steps 2–3).
 *
 * Projection, not SELECT *: the row is served without authentication, and the
 * columns a partner manages beyond these four (ids, timestamps, anything added
 * later) are not the guest's business.
 *
 * @param {string} establishmentId - UUID
 * @returns {object|null} { max_guests_per_booking, max_days_ahead,
 *   min_hours_before, confirmation_timeout_hours } or null
 */
export const getPublicTerms = async (establishmentId) => {
  const query = `
    SELECT bs.max_guests_per_booking,
           bs.max_days_ahead,
           bs.min_hours_before,
           bs.confirmation_timeout_hours
      FROM booking_settings bs
      JOIN establishments e ON e.id = bs.establishment_id
     WHERE bs.establishment_id = $1
       AND bs.is_enabled = TRUE
       AND e.status = 'active'
  `;
  try {
    const result = await pool.query(query, [establishmentId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting public booking terms', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Create or update booking settings (UPSERT).
 *
 * @param {object} data - { establishmentId, maxGuestsPerBooking, confirmationTimeoutHours, maxDaysAhead, minHoursBefore }
 * @param {object} [client] - optional DB client for transactions
 * @returns {object} upserted row
 */
export const createOrUpdate = async (data, client) => {
  const queryExecutor = client || pool;
  const {
    establishmentId,
    isEnabled = false,
    maxGuestsPerBooking = 10,
    confirmationTimeoutHours = 4,
    maxDaysAhead = 7,
    minHoursBefore = 2,
  } = data;

  const query = `
    INSERT INTO booking_settings (
      establishment_id, is_enabled, max_guests_per_booking,
      confirmation_timeout_hours, max_days_ahead, min_hours_before
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (establishment_id)
    DO UPDATE SET
      is_enabled = $2,
      max_guests_per_booking = $3,
      confirmation_timeout_hours = $4,
      max_days_ahead = $5,
      min_hours_before = $6,
      updated_at = NOW()
    RETURNING *
  `;

  try {
    const result = await queryExecutor.query(query, [
      establishmentId,
      isEnabled,
      maxGuestsPerBooking,
      confirmationTimeoutHours,
      maxDaysAhead,
      minHoursBefore,
    ]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error upserting booking settings', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Toggle is_enabled flag.
 *
 * @param {string} establishmentId
 * @param {boolean} isEnabled
 * @param {object} [client] - optional DB client for transactions
 * @returns {object|null} updated row
 */
export const updateEnabled = async (establishmentId, isEnabled, client) => {
  const queryExecutor = client || pool;
  const query = `
    UPDATE booking_settings
    SET is_enabled = $2, updated_at = NOW()
    WHERE establishment_id = $1
    RETURNING *
  `;
  try {
    const result = await queryExecutor.query(query, [establishmentId, isEnabled]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error updating booking settings enabled', {
      error: error.message,
      establishmentId,
      isEnabled,
    });
    throw error;
  }
};
