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
import * as analyticsController from '../../controllers/analyticsController.js';
import * as auditLogController from '../../controllers/auditLogController.js';
import * as adminReviewController from '../../controllers/adminReviewController.js';
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

// ============================================================================
// Segment C: Active, Rejected, Search (must be BEFORE :id param route)
// ============================================================================

/**
 * GET /api/v1/admin/establishments/active
 *
 * List active (approved) establishments.
 * Query: ?page=1&per_page=20&sort=newest&city=Минск&search=name
 */
router.get(
  '/establishments/active',
  authenticate,
  authorize(['admin']),
  adminModerationController.listActiveEstablishments,
);

/**
 * GET /api/v1/admin/establishments/rejected
 *
 * List rejection history from audit log.
 * Query: ?page=1&per_page=20
 */
router.get(
  '/establishments/rejected',
  authenticate,
  authorize(['admin']),
  adminModerationController.listRejectedEstablishments,
);

/**
 * GET /api/v1/admin/establishments/search
 *
 * Search establishments across all statuses.
 * Query: ?search=name (required) &status=active&city=Минск&page=1&per_page=20
 */
router.get(
  '/establishments/search',
  authenticate,
  authorize(['admin']),
  adminModerationController.searchEstablishments,
);

// ============================================================================
// Establishment detail and actions (parameterized :id routes)
// ============================================================================

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

/**
 * POST /api/v1/admin/establishments/:id/suspend
 *
 * Suspend an active establishment.
 * Body: { reason: "string" }
 */
router.post(
  '/establishments/:id/suspend',
  authenticate,
  authorize(['admin']),
  adminModerationController.suspendEstablishment,
);

/**
 * POST /api/v1/admin/establishments/:id/unsuspend
 *
 * Reactivate a suspended establishment.
 */
router.post(
  '/establishments/:id/unsuspend',
  authenticate,
  authorize(['admin']),
  adminModerationController.unsuspendEstablishment,
);

/**
 * PATCH /api/v1/admin/establishments/:id/coordinates
 *
 * Update establishment coordinates (admin correction).
 * Body: { latitude: number, longitude: number }
 */
router.patch(
  '/establishments/:id/coordinates',
  authenticate,
  authorize(['admin']),
  adminModerationController.updateCoordinates,
);

// ============================================================================
// Segment D: Analytics & Dashboard
// ============================================================================

/**
 * GET /api/v1/admin/analytics/overview
 *
 * Dashboard overview metrics (users, establishments, reviews, moderation).
 * Query: ?period=7d|30d|90d  or  ?from=2026-01-01&to=2026-01-31
 */
router.get(
  '/analytics/overview',
  authenticate,
  authorize(['admin']),
  analyticsController.getOverview,
);

/**
 * GET /api/v1/admin/analytics/users
 *
 * User analytics: registration timeline, role distribution.
 * Query: ?period=30d
 */
router.get(
  '/analytics/users',
  authenticate,
  authorize(['admin']),
  analyticsController.getUsersAnalytics,
);

/**
 * GET /api/v1/admin/analytics/establishments
 *
 * Establishment analytics: creation timeline, status/city/category distributions.
 * Query: ?period=30d
 */
router.get(
  '/analytics/establishments',
  authenticate,
  authorize(['admin']),
  analyticsController.getEstablishmentsAnalytics,
);

/**
 * GET /api/v1/admin/analytics/reviews
 *
 * Review analytics: review timeline, rating distribution, response stats.
 * Query: ?period=30d
 */
router.get(
  '/analytics/reviews',
  authenticate,
  authorize(['admin']),
  analyticsController.getReviewsAnalytics,
);

// ============================================================================
// Segment E: Reviews Management
// ============================================================================

/**
 * GET /api/v1/admin/reviews
 *
 * List all reviews (admin view — includes deleted/hidden).
 * Query: ?page=1&per_page=20&status=visible|hidden|deleted&rating=1-5
 *        &search=text&sort=newest|oldest|rating_high|rating_low
 *        &establishment_id=uuid&user_id=uuid&from=date&to=date
 */
router.get(
  '/reviews',
  authenticate,
  authorize(['admin']),
  adminReviewController.listReviews,
);

/**
 * POST /api/v1/admin/reviews/:id/toggle-visibility
 *
 * Toggle review visibility (is_visible = NOT is_visible).
 * Writes audit_log entry.
 */
router.post(
  '/reviews/:id/toggle-visibility',
  authenticate,
  authorize(['admin']),
  adminReviewController.toggleVisibility,
);

/**
 * POST /api/v1/admin/reviews/:id/delete
 *
 * Soft-delete a review and recalculate establishment aggregates.
 * Body: { reason: "string" } (optional)
 * Writes audit_log entry.
 */
router.post(
  '/reviews/:id/delete',
  authenticate,
  authorize(['admin']),
  adminReviewController.deleteReview,
);

// ============================================================================
// Segment E: Audit Log
// ============================================================================

/**
 * GET /api/v1/admin/audit-log
 *
 * Paginated audit log entries with admin info and action summary.
 * Query: ?page=1&per_page=20&action=moderate_approve&entity_type=establishment
 *        &user_id=uuid&from=2026-01-01&to=2026-01-31&sort=newest&include_metadata=true
 */
router.get(
  '/audit-log',
  authenticate,
  authorize(['admin']),
  auditLogController.listAuditLog,
);

export default router;
