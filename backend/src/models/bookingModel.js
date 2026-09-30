/**
 * Booking Model
 *
 * CRUD operations for the bookings table.
 * Implements lazy expiry: every read method expires pending bookings
 * past their deadline before returning results.
 *
 * Tables: bookings
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * The clock bookings are made on: guests book a date and a time of day in
 * Minsk, stored without a zone. Named explicitly in every computation below —
 * the process clock is not this clock (production runs UTC, CI Europe/Minsk).
 */
export const BOOKING_TIME_ZONE = 'Europe/Minsk';

// ============================================================================
// Lazy Expiry (called before reads)
// ============================================================================

/**
 * Expire pending bookings past their expires_at deadline.
 * Scoped to a single establishment or globally.
 *
 * @param {string|null} establishmentId - scope to establishment, or null for global
 */
const expirePendingBookings = async (establishmentId = null) => {
  try {
    const query = establishmentId
      ? `UPDATE bookings SET status = 'expired', updated_at = NOW()
         WHERE status = 'pending' AND expires_at < NOW()
         AND establishment_id = $1`
      : `UPDATE bookings SET status = 'expired', updated_at = NOW()
         WHERE status = 'pending' AND expires_at < NOW()`;

    const params = establishmentId ? [establishmentId] : [];
    const result = await pool.query(query, params);

    if (result.rowCount > 0) {
      logger.info('Lazy expiry: expired pending bookings', {
        count: result.rowCount,
        establishmentId,
      });
    }
  } catch (error) {
    logger.error('Error in lazy expiry of bookings', {
      error: error.message,
      establishmentId,
    });
  }
};

/**
 * Expire pending bookings for a specific user scope.
 */
const expirePendingBookingsForUser = async (userId) => {
  try {
    const result = await pool.query(
      `UPDATE bookings SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at < NOW()
       AND user_id = $1`,
      [userId],
    );
    if (result.rowCount > 0) {
      logger.info('Lazy expiry: expired pending bookings for user', {
        count: result.rowCount,
        userId,
      });
    }
  } catch (error) {
    logger.error('Error in lazy expiry for user bookings', {
      error: error.message,
      userId,
    });
  }
};

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Where a requested slot sits against "now" on the Minsk clock — one reading
 * for all of createBooking's date and time checks.
 *
 * Computed in SQL, the project's path for zone-less time: `AT TIME ZONE` turns
 * the Minsk wall clock of the slot into an instant, and "today" is the Minsk
 * calendar date of now. The old JS arithmetic ran on the process clock — on
 * UTC production a slot that had already passed looked three hours ahead, and
 * from 00:00 to 03:00 Minsk "today" was still yesterday (review 23.09, #35).
 *
 * @param {object} p
 * @param {string} p.bookingDate - 'YYYY-MM-DD', Minsk calendar date
 * @param {string} p.bookingTime - 'HH:MM', Minsk wall clock
 * @param {number} p.maxDaysAhead - booking_settings.max_days_ahead
 * @param {Date|null} [p.now] - injectable clock for tests; null = NOW()
 * @returns {Promise<{isPastDate: boolean, isTooFar: boolean, dayOfWeek: number, hoursUntil: number}>}
 *   dayOfWeek: 0 = Sunday, as JS getDay()
 */
export const checkSlot = async ({ bookingDate, bookingTime, maxDaysAhead, now = null }) => {
  const query = `
    WITH clock AS (SELECT COALESCE($4::timestamptz, NOW()) AS now)
    SELECT $1::date < (clock.now AT TIME ZONE $5)::date               AS is_past_date,
           $1::date > (clock.now AT TIME ZONE $5)::date + $3::int     AS is_too_far,
           EXTRACT(DOW FROM $1::date)::int                            AS day_of_week,
           (EXTRACT(EPOCH FROM ((($1::date + $2::time) AT TIME ZONE $5) - clock.now))
             / 3600)::float8                                          AS hours_until
      FROM clock
  `;

  try {
    const result = await pool.query(query, [
      bookingDate,
      bookingTime,
      maxDaysAhead,
      now ? now.toISOString() : null,
      BOOKING_TIME_ZONE,
    ]);
    const row = result.rows[0];
    return {
      isPastDate: row.is_past_date,
      isTooFar: row.is_too_far,
      dayOfWeek: row.day_of_week,
      hoursUntil: row.hours_until,
    };
  } catch (error) {
    logger.error('Error checking booking slot', {
      error: error.message,
      bookingDate,
      bookingTime,
    });
    throw error;
  }
};

/**
 * Create a new booking.
 *
 * expires_at is computed here, from the database clock (or the injected one):
 * a JS Date bound into this zone-less column would be written as the PROCESS's
 * wall clock — three hours late under Europe/Minsk. `AT TIME ZONE 'UTC'` stores
 * UTC wall clock, which is what NOW() writes into every such column and what
 * the lazy expiry above compares against.
 *
 * @param {object} data
 * @param {number} data.confirmationTimeoutHours - booking_settings.confirmation_timeout_hours
 * @param {Date|null} [data.now] - injectable clock for tests; null = NOW()
 * @returns {object} created booking row
 */
export const create = async (data) => {
  const {
    establishmentId,
    userId,
    bookingDate,
    bookingTime,
    guestCount,
    comment,
    contactPhone,
    confirmationTimeoutHours,
    now = null,
  } = data;

  const query = `
    INSERT INTO bookings (
      establishment_id, user_id, booking_date, booking_time,
      guest_count, comment, contact_phone, expires_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7,
            (COALESCE($8::timestamptz, NOW()) + make_interval(hours => $9::int)) AT TIME ZONE 'UTC')
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [
      establishmentId,
      userId,
      bookingDate,
      bookingTime,
      guestCount,
      comment || null,
      contactPhone,
      now ? now.toISOString() : null,
      confirmationTimeoutHours,
    ]);
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating booking', {
      error: error.message,
      establishmentId,
      userId,
    });
    throw error;
  }
};

/**
 * Update booking status with optional fields.
 *
 * @param {string} bookingId
 * @param {object} updates - { status, declineReason?, confirmedAt?, cancelledAt? }
 * @returns {object|null} updated booking row
 */
export const updateStatus = async (bookingId, updates) => {
  const { status, declineReason, confirmedAt, cancelledAt } = updates;

  const setClauses = ['status = $2', 'updated_at = NOW()'];
  const params = [bookingId, status];
  let paramIndex = 3;

  if (declineReason !== undefined) {
    setClauses.push(`decline_reason = $${paramIndex}`);
    params.push(declineReason);
    paramIndex++;
  }

  if (confirmedAt !== undefined) {
    setClauses.push(`confirmed_at = $${paramIndex}`);
    params.push(confirmedAt);
    paramIndex++;
  }

  if (cancelledAt !== undefined) {
    setClauses.push(`cancelled_at = $${paramIndex}`);
    params.push(cancelledAt);
    paramIndex++;
  }

  const query = `
    UPDATE bookings
    SET ${setClauses.join(', ')}
    WHERE id = $1
    RETURNING *
  `;

  try {
    const result = await pool.query(query, params);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error updating booking status', {
      error: error.message,
      bookingId,
      status,
    });
    throw error;
  }
};

// ============================================================================
// Read Operations (with lazy expiry)
// ============================================================================

/**
 * Get booking by ID.
 *
 * @param {string} bookingId
 * @returns {object|null}
 */
export const getById = async (bookingId) => {
  const query = `
    SELECT b.*, e.name AS establishment_name, u.name AS user_name, u.phone AS user_phone
    FROM bookings b
    JOIN establishments e ON b.establishment_id = e.id
    JOIN users u ON b.user_id = u.id
    WHERE b.id = $1
  `;
  try {
    const result = await pool.query(query, [bookingId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting booking by id', {
      error: error.message,
      bookingId,
    });
    throw error;
  }
};

/**
 * Get bookings for an establishment (partner view), with optional status filter.
 * Applies lazy expiry before reading.
 *
 * @param {string} establishmentId
 * @param {object} options - { status?, limit?, offset? }
 * @returns {object} { items, total }
 */
export const getByEstablishmentId = async (establishmentId, options = {}) => {
  await expirePendingBookings(establishmentId);

  const { status, limit = 50, offset = 0 } = options;

  let whereClause = 'WHERE b.establishment_id = $1';
  const params = [establishmentId];
  let paramIndex = 2;

  if (status) {
    whereClause += ` AND b.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM bookings b
    ${whereClause}
  `;

  const dataQuery = `
    SELECT b.*, u.name AS user_name, u.phone AS user_phone
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    ${whereClause}
    ORDER BY b.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  params.push(limit, offset);

  try {
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, params.slice(0, paramIndex - 1)),
      pool.query(dataQuery, params),
    ]);

    return {
      items: dataResult.rows,
      total: countResult.rows[0].total,
    };
  } catch (error) {
    logger.error('Error getting bookings by establishment', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Get bookings for a user (user view).
 * Applies lazy expiry before reading.
 *
 * @param {string} userId
 * @returns {Array} booking rows with establishment name
 */
export const getByUserId = async (userId) => {
  await expirePendingBookingsForUser(userId);

  const query = `
    SELECT b.*, e.name AS establishment_name, e.address AS establishment_address,
           e.phone AS establishment_phone
    FROM bookings b
    JOIN establishments e ON b.establishment_id = e.id
    WHERE b.user_id = $1
    ORDER BY b.created_at DESC
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows;
  } catch (error) {
    logger.error('Error getting bookings by user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Count active bookings (pending or confirmed) for a user.
 * Used for the 2-booking limit.
 *
 * @param {string} userId
 * @returns {number}
 */
export const getActiveCountForUser = async (userId) => {
  await expirePendingBookingsForUser(userId);

  const query = `
    SELECT COUNT(*)::int AS count
    FROM bookings
    WHERE user_id = $1 AND status IN ('pending', 'confirmed')
  `;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows[0].count;
  } catch (error) {
    logger.error('Error getting active booking count for user', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Check if user has an active booking at a specific establishment.
 * Used for the 1-per-establishment limit.
 *
 * @param {string} userId
 * @param {string} establishmentId
 * @returns {object|null} existing active booking or null
 */
export const getActiveForEstablishmentAndUser = async (userId, establishmentId) => {
  await expirePendingBookingsForUser(userId);

  const query = `
    SELECT * FROM bookings
    WHERE user_id = $1
      AND establishment_id = $2
      AND status IN ('pending', 'confirmed')
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [userId, establishmentId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error checking active booking for user at establishment', {
      error: error.message,
      userId,
      establishmentId,
    });
    throw error;
  }
};
