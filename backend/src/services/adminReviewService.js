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
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Get paginated admin reviews with filters
 *
 * @param {Object} params
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

    const [reviews, total] = await Promise.all([
      AdminReviewModel.getAdminReviews(filters, effectivePerPage, offset),
      AdminReviewModel.countAdminReviews(filters),
    ]);

    return {
      reviews,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage),
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
 * Toggle review visibility and write audit log
 *
 * @param {string} reviewId
 * @param {string} adminUserId - UUID of admin performing the action
 * @returns {Promise<Object>} Updated review { id, is_visible }
 */
export const toggleVisibility = async (reviewId, adminUserId) => {
  try {
    const result = await AdminReviewModel.toggleReviewVisibility(reviewId);

    if (!result) {
      throw new AppError(
        'Review not found or already deleted',
        404,
        'REVIEW_NOT_FOUND',
      );
    }

    // Non-blocking audit log write
    const action = result.is_visible ? 'review_show' : 'review_hide';
    AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action,
      entity_type: 'review',
      entity_id: reviewId,
      new_data: { is_visible: result.is_visible },
    });

    return result;
  } catch (error) {
    if (error.code) throw error; // Re-throw AppError
    logger.error('Error in toggleVisibility service', {
      error: error.message,
      reviewId,
    });
    throw new AppError(
      'Failed to toggle review visibility',
      500,
      'VISIBILITY_TOGGLE_FAILED',
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
export const deleteReview = async (reviewId, adminUserId, reason) => {
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

    // Non-blocking audit log write
    AuditLogModel.createAuditLog({
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
