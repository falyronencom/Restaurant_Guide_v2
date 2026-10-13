/**
 * Admin Review Controller
 *
 * HTTP handlers for admin review management endpoints.
 * Thin layer: extracts request data, delegates to service, formats response.
 *
 * Endpoints (Segment E):
 *   GET  /api/v1/admin/reviews                    — list all reviews (admin view)
 *   POST /api/v1/admin/reviews/:id/visibility        — set review visibility { is_visible }
 *   POST /api/v1/admin/reviews/:id/delete         — soft-delete review
 */

import * as adminReviewService from '../services/adminReviewService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isViewer } from '../config/panelRoles.js';
import logger from '../utils/logger.js';

/**
 * GET /api/v1/admin/reviews
 *
 * Returns paginated reviews with author and establishment info.
 * Admin can see all reviews including deleted and hidden. A viewer gets the
 * same list with author_email = null (see adminReviewService.getReviews).
 */
export const listReviews = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;
  const {
    establishment_id,
    user_id,
    rating,
    status,
    search,
    sort,
    from,
    to,
  } = req.query;

  const result = await adminReviewService.getReviews({
    page,
    perPage,
    establishment_id,
    user_id,
    rating,
    status,
    search,
    sort,
    from,
    to,
    viewer: isViewer(req.user.role),
  });

  logger.info('Admin fetched reviews list', {
    adminId: req.user.userId,
    count: result.reviews.length,
    total: result.meta.total,
    filters: { status, rating, search },
    endpoint: 'GET /api/v1/admin/reviews',
  });

  res.status(200).json({
    success: true,
    data: result.reviews,
    meta: result.meta,
  });
});

/**
 * POST /api/v1/admin/reviews/:id/visibility
 * Body: { is_visible: boolean }
 *
 * Sets is_visible to the value asked for — never toggles: the panel repeats a
 * request answered with a 5xx, and a toggle applied once and answered late
 * would be undone by its own repeat (critics' pack 1, point 2 — Codex C-10).
 * Writes audit_log entry (review_hide or review_show) when the state changed.
 */
export const setVisibility = asyncHandler(async (req, res) => {
  const reviewId = req.params.id;
  const adminUserId = req.user.userId;
  const isVisible = req.body.is_visible === true;

  const result = await adminReviewService.setVisibility(reviewId, isVisible, adminUserId, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  logger.info('Admin set review visibility', {
    adminId: adminUserId,
    reviewId,
    isVisible: result.is_visible,
    changed: result.changed,
    endpoint: 'POST /api/v1/admin/reviews/:id/visibility',
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/admin/reviews/:id/delete
 *
 * Soft-deletes a review and recalculates establishment aggregates.
 * Writes audit_log entry with optional reason.
 * Body: { reason: "string" } (optional)
 */
export const deleteReview = asyncHandler(async (req, res) => {
  const reviewId = req.params.id;
  const adminUserId = req.user.userId;
  const { reason } = req.body || {};

  await adminReviewService.deleteReview(reviewId, adminUserId, reason, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  logger.info('Admin deleted review', {
    adminId: adminUserId,
    reviewId,
    reason: reason || 'no reason provided',
    endpoint: 'POST /api/v1/admin/reviews/:id/delete',
  });

  res.status(200).json({
    success: true,
    data: { message: 'Review deleted successfully' },
  });
});
