/**
 * Notification Validation
 *
 * express-validator chains for the notification endpoints, used with
 * validate() from middleware/errorHandler.js (422 VALIDATION_ERROR with field
 * details).
 */

import { query } from 'express-validator';

/**
 * GET /api/v1/notifications — the user's list.
 *
 * A page below 1 made the OFFSET negative and a negative `limit` the LIMIT —
 * a 500 with the database's code; a non-number came back as a 400 logged as a
 * server error; `limit=0` answered an empty page, and a `limit` above 50 was
 * quietly cut to 50 (stand probe 16.10.2026). The rule is the reviews' and
 * favorites' one — a page ≥ 1, a page size of 1–50; the page's ceiling
 * (MAX_PAGE) is checked earlier, by middleware/requestGuard.js. Every version
 * of the app sends a page ≥ 1 and limit=20.
 */
export const validateGetNotifications = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
];
