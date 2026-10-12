/**
 * Admin Review Service
 *
 * Business logic for admin review management.
 * Orchestrates review listing, visibility toggling, and deletion
 * with audit log writes for accountability.
 *
 * Architecture: Controller → Service → Model
 * Segment E: Utility Screens
 */

import * as AdminReviewModel from '../models/adminReviewModel.js';
import * as ReviewModel from '../models/reviewModel.js';
import * as AuditLogModel from '../models/auditLogModel.js';
import * as NotificationService from './notificationService.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Get paginated admin reviews with filters
 *
 * A viewer — the read-only panel role that may be shown to a third party —
 * gets the reviews without the author's e-mail: the key stays, the value is
 * null, the same as the partner contacts on the establishment card
 * (Coordinator decision 2026-09-08, SDL CAT-C-2.11). The panel then shows
 * the author by name.
 *
 * @param {Object} params
 * @param {boolean} [params.viewer=false] - Caller is the read-only panel role
 * @returns {Promise<Object>} { reviews, meta }
 */
export const getReviews = async ({
  page = 1,
  perPage = 20,
  establishment_id,
  user_id,
  rating,
  status,
  search,
  sort = 'newest',
  from,
  to,
  viewer = false,
} = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const filters = {
      establishment_id,
      user_id,
      rating,
      status,
      search,
      sort,
      from,
      to,
    };

    const [reviews, stats] = await Promise.all([
      AdminReviewModel.getAdminReviews(filters, effectivePerPage, offset),
      AdminReviewModel.getReviewStats(filters),
    ]);

    return {
      reviews: viewer
        ? reviews.map((review) => ({ ...review, author_email: null }))
        : reviews,
      meta: {
        total: stats.total,
        // Считаются по той же выборке, что и total: подпись экрана
        // «180 отзывов · 3 скрыто · средний 1,6» под фильтром «1–2 звезды»
        // описывает отфильтрованное, а не раздел целиком.
        hidden: stats.hidden,
        average_rating: stats.average_rating,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(stats.total / effectivePerPage),
      },
    };
  } catch (error) {
    logger.error('Error in getReviews service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch reviews',
      500,
      'REVIEWS_FETCH_FAILED',
    );
  }
};

/**
 * Set review visibility to the state the moderator asked for, and write the
 * audit log when the state actually changed.
 *
 * Idempotent on purpose: the panel's client repeats a request answered with a
 * 5xx, and the first attempt may have been applied before the answer was lost.
 * A repeat that finds the review already in the requested state changes
 * nothing — no second audit row, no second notice to the author, no
 * recalculation (critics' pack 1, point 2 — Codex C-10).
 *
 * @param {string} reviewId
 * @param {boolean} isVisible - true: show, false: hide
 * @param {string} adminUserId - UUID of admin performing the action
 * @returns {Promise<Object>} { id, is_visible, establishment_id, changed }
 */
export const setVisibility = async (reviewId, isVisible, adminUserId, { ipAddress, userAgent } = {}) => {
  try {
    const review = await AdminReviewModel.getReviewForAdmin(reviewId);

    if (!review || review.is_deleted) {
      throw new AppError(
        'Review not found or already deleted',
        404,
        'REVIEW_NOT_FOUND',
      );
    }

    // A repeat (or a decision already in force) writes nothing — but the
    // aggregates are recalculated anyway: the first attempt may have changed
    // the row and died before its own recalculation, and the schema trigger
    // counts hidden reviews in (review of 08.10.2026). The UPDATE is
    // idempotent and cheap.
    if (review.is_visible === isVisible) {
      await ReviewModel.updateEstablishmentAggregates(review.establishment_id);
      return {
        id: review.id,
        is_visible: review.is_visible,
        establishment_id: review.establishment_id,
        changed: false,
      };
    }

    let result = await AdminReviewModel.setReviewVisibility(reviewId, isVisible, review.is_visible);

    if (!result) {
      // Changed between the read and the write — by another moderator or by a
      // repeat of this very request. Re-read: the requested state reached is
      // a success, anything else is a conflict to show.
      const current = await AdminReviewModel.getReviewForAdmin(reviewId);
      if (!current || current.is_deleted) {
        throw new AppError(
          'Review not found or already deleted',
          404,
          'REVIEW_NOT_FOUND',
        );
      }
      if (current.is_visible === isVisible) {
        await ReviewModel.updateEstablishmentAggregates(current.establishment_id);
        return {
          id: current.id,
          is_visible: current.is_visible,
          establishment_id: current.establishment_id,
          changed: false,
        };
      }
      throw new AppError(
        'Review visibility was changed concurrently',
        409,
        'VISIBILITY_CONFLICT',
      );
    }

    result = { ...result, changed: true };

    // Recalculate establishment aggregates (hidden reviews excluded from rating)
    await ReviewModel.updateEstablishmentAggregates(result.establishment_id);

    // Audit log — awaited for determinism and parity with the other admin
    // handlers: the row must exist by the time the response returns.
    // createAuditLog swallows its own errors, so awaiting cannot fail the call.
    const action = result.is_visible ? 'review_show' : 'review_hide';
    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action,
      entity_type: 'review',
      entity_id: reviewId,
      new_data: { is_visible: result.is_visible },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Notify review author only when hiding (non-blocking)
    if (!result.is_visible) {
      NotificationService.notifyReviewModerated(reviewId, 'hidden')
        .catch(() => {});
    }

    return result;
  } catch (error) {
    if (error.code) throw error; // Re-throw AppError
    logger.error('Error in setVisibility service', {
      error: error.message,
      reviewId,
    });
    throw new AppError(
      'Failed to set review visibility',
      500,
      'VISIBILITY_UPDATE_FAILED',
    );
  }
};

/**
 * Soft-delete a review, update establishment aggregates, write audit log
 *
 * @param {string} reviewId
 * @param {string} adminUserId
 * @param {string} [reason] - Optional reason for deletion
 * @returns {Promise<Object>} { success: true }
 */
export const deleteReview = async (reviewId, adminUserId, reason, { ipAddress, userAgent } = {}) => {
  try {
    // Get review info before deletion (for establishment_id)
    const review = await AdminReviewModel.getReviewForAdmin(reviewId);

    if (!review) {
      throw new AppError(
        'Review not found',
        404,
        'REVIEW_NOT_FOUND',
      );
    }

    if (review.is_deleted) {
      throw new AppError(
        'Review is already deleted',
        400,
        'REVIEW_ALREADY_DELETED',
      );
    }

    // Soft-delete the review
    const deleted = await ReviewModel.softDeleteReview(reviewId);

    if (!deleted) {
      throw new AppError(
        'Failed to delete review',
        500,
        'REVIEW_DELETE_FAILED',
      );
    }

    // Recalculate establishment aggregates (rating/count)
    await ReviewModel.updateEstablishmentAggregates(review.establishment_id);

    // Notify review author (non-blocking)
    NotificationService.notifyReviewModerated(reviewId, 'deleted')
      .catch(() => {});

    // Audit log — awaited for determinism and parity with the other admin
    // handlers: the row must exist by the time the response returns.
    // createAuditLog swallows its own errors, so awaiting cannot fail the call.
    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'review_delete',
      entity_type: 'review',
      entity_id: reviewId,
      old_data: {
        is_deleted: false,
        is_visible: review.is_visible,
        establishment_id: review.establishment_id,
      },
      new_data: {
        is_deleted: true,
        reason: reason || null,
      },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    return { success: true };
  } catch (error) {
    if (error.code) throw error; // Re-throw AppError
    logger.error('Error in deleteReview service', {
      error: error.message,
      reviewId,
    });
    throw new AppError(
      'Failed to delete review',
      500,
      'REVIEW_DELETE_FAILED',
    );
  }
};
