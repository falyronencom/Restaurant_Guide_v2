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
 * Create a new booking.
 *
 * @param {object} data
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
    expiresAt,
  } = data;

  const query = `
    INSERT INTO bookings (
      establishment_id, user_id, booking_date, booking_time,
      guest_count, comment, contact_phone, expires_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      expiresAt,
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
