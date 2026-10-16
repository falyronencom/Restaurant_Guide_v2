/**
 * Booking Validation
 *
 * express-validator chains for the booking endpoints, used with validate()
 * from middleware/errorHandler.js (422 VALIDATION_ERROR with field details).
 */

import { query } from 'express-validator';

/**
 * GET /api/v1/partner/bookings/:establishmentId — the partner's list.
 *
 * `limit` and `offset` went to SQL with no lower bound and `limit` with no
 * upper one: a negative value or a `limit` past bigint came back as a 500
 * with the database's code, a non-number as a 400 logged as a server error
 * (stand probe 16.10.2026). The rule is the reviews' and favorites' one —
 * a page size of 1–50 (the model's default is 50), an offset ≥ 0; the offset's
 * ceiling (MAX_OFFSET) is checked earlier, by middleware/requestGuard.js.
 * The app sends neither: it lists with the defaults.
 */
export const validateGetPartnerBookings = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),

  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer'),
];
