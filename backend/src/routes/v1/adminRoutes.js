/**
 * Admin Routes
 *
 * Defines admin-specific API endpoints:
 * - Authentication with stricter rate limiting
 * - Moderation workflow (list pending, view details, approve/reject)
 *
 * All admin routes are mounted at /api/v1/admin/*
 */

import express from 'express';
import * as adminController from '../../controllers/adminController.js';
import * as adminModerationController from '../../controllers/adminModerationController.js';
import { validateLogin } from '../../validators/authValidation.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = express.Router();

// ============================================================================
// Authentication (public — no auth required)
// ============================================================================

/**
 * POST /api/v1/admin/auth/login
 *
 * Admin login endpoint. Uses the same validation as standard login
 * but with stricter rate limiting (5 req/min vs 10 for regular users)
 * and an additional role check in the controller.
 *
 * Middleware chain:
 * 1. Rate limiter: 5 requests per minute per IP (strict for admin)
 * 2. Validation: Reuses validateLogin (email/phone format + password presence)
 * 3. Controller: Verify credentials + check admin role + generate tokens
 */
router.post(
  '/auth/login',
  createRateLimiter({
    limit: 5,
    windowSeconds: 60,
    keyPrefix: 'admin-login',
  }),
  validateLogin,
  adminController.adminLogin,
);

// ============================================================================
// Moderation (protected — requires admin role)
// ============================================================================

/**
 * GET /api/v1/admin/establishments/pending
 *
 * List establishments awaiting moderation review.
 * Query: ?page=1&per_page=20
 */
router.get(
  '/establishments/pending',
  authenticate,
  authorize(['admin']),
  adminModerationController.listPendingEstablishments,
);

/**
 * GET /api/v1/admin/establishments/:id
 *
 * Get full establishment details for moderation review.
 * Returns data organized for four-tab display.
 */
router.get(
  '/establishments/:id',
  authenticate,
  authorize(['admin']),
  adminModerationController.getEstablishmentDetails,
);

/**
 * POST /api/v1/admin/establishments/:id/moderate
 *
 * Execute moderation action (approve or reject).
 * Body: { action: "approve"|"reject", moderation_notes: { field: "comment" } }
 */
router.post(
  '/establishments/:id/moderate',
  authenticate,
  authorize(['admin']),
  adminModerationController.moderateEstablishment,
);

export default router;
