/**
 * Booking Settings Routes
 *
 * Partner-facing booking settings endpoints:
 *   GET    /api/v1/partner/booking-settings/:establishmentId              — get settings
 *   POST   /api/v1/partner/booking-settings/:establishmentId/activate     — activate booking
 *   PUT    /api/v1/partner/booking-settings/:establishmentId              — update settings
 *   POST   /api/v1/partner/booking-settings/:establishmentId/deactivate   — deactivate booking
 *
 * All endpoints require authentication and partner role.
 * Ownership verified at the service layer.
 */

import express from 'express';
import * as BookingSettingsController from '../../controllers/bookingSettingsController.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = express.Router();

// All routes require authenticated partner
router.use(authenticate);
router.use(authorize('partner'));

// GET /:establishmentId — get current settings
router.get(
  '/:establishmentId',
  BookingSettingsController.getSettings,
);

// POST /:establishmentId/activate — activate booking
router.post(
  '/:establishmentId/activate',
  BookingSettingsController.activate,
);

// PUT /:establishmentId — update settings
router.put(
  '/:establishmentId',
  BookingSettingsController.updateSettings,
);

// POST /:establishmentId/deactivate — deactivate booking
router.post(
  '/:establishmentId/deactivate',
  BookingSettingsController.deactivate,
);

export default router;
