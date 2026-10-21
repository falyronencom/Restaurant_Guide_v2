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

import { randomUUID } from 'crypto';
import { getClient } from '../config/database.js';
import * as AdminReviewModel from '../models/adminReviewModel.js';
import * as ReviewModel from '../models/reviewModel.js';
import * as AuditLogModel from '../models/auditLogModel.js';
import * as NotificationService from './notificationService.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/** A reason longer than this is refused: it is a note, not a letter (the limit of a block). */
export const REASON_MAX_LENGTH = 500;

/** How many reviews one «Скрыть выбранные» may carry. */
export const HIDE_BATCH_MAX = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the moderator reads when the server refuses. Russian: the panel shows
 * the server's text as it is (walkthrough 20.10, A2-02; the pattern of
 * adminUserService.USER_ACTION_REFUSALS). Codes and statuses are the ones the
 * panel has known before.
 */
export const REVIEW_REFUSALS = Object.freeze({
  REVIEW_NOT_FOUND: 'Отзыв не найден или уже удалён',
  REVIEW_ALREADY_DELETED: 'Отзыв уже удалён',
  VISIBILITY_CONFLICT: 'Видимость отзыва только что изменил другой модератор — список обновлён',
  VIEWER_PERSON_FILTER_FORBIDDEN: 'Отзывы одного человека недоступны в режиме просмотра',
  RATING_FILTER_INVALID: 'Оценка в фильтре — целое число от 1 до 5',
  AUTHOR_FILTER_INVALID: 'Автор в фильтре указан неверно — откройте отзывы автора из его карточки',
  REASON_REQUIRED: 'Укажите причину',
  REASON_TOO_LONG: `Причина длиннее ${REASON_MAX_LENGTH} символов — сократите её`,
  BATCH_EMPTY: 'Не выбрано ни одного отзыва',
  BATCH_TOO_LARGE: `За один раз можно скрыть не больше ${HIDE_BATCH_MAX} отзывов`,
  BATCH_INVALID_ID: 'В списке отзывов есть неверный идентификатор — обновите страницу',
  REVIEWS_FETCH_FAILED: 'Отзывы не загрузились: сбой на сервере. Попробуйте ещё раз',
  VISIBILITY_UPDATE_FAILED: 'Видимость отзыва не изменилась: сбой на сервере. Попробуйте ещё раз',
  REVIEW_DELETE_FAILED: 'Отзыв не удалён: сбой на сервере. Попробуйте ещё раз',
  HIDE_BATCH_FAILED: 'Отзывы не скрыты: сбой на сервере. Попробуйте ещё раз',
});

const refuse = (code, status) => new AppError(REVIEW_REFUSALS[code], status, code);

/**
 * The moderator's reason as written to the journal: trimmed, bounded, and —
 * where the action asks for one — required. An absent optional reason is null.
 *
 * @param {*} raw
 * @param {Object} [options]
 * @param {boolean} [options.required=false]
 * @returns {string|null}
 */
export const normalizeReviewReason = (raw, { required = false } = {}) => {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw refuse('REASON_REQUIRED', 422);
  }
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason) {
    if (required) throw refuse('REASON_REQUIRED', 422);
    return null;
  }
  if (reason.length > REASON_MAX_LENGTH) throw refuse('REASON_TOO_LONG', 422);
  return reason;
};

/**
 * A rating filter value: absent, or a whole number 1–5. Anything else is
 * refused — ignoring it would show the whole list under a filter the
 * moderator believes is applied, and passing it on gave a 500.
 *
 * @param {*} raw
 * @returns {number|undefined}
 */
const ratingParam = (raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = String(raw).trim();
  if (!/^[1-5]$/.test(text)) throw refuse('RATING_FILTER_INVALID', 422);
  return Number(text);
};

/**
 * Why a hidden review is hidden, from the journal row the model found: by the
 * moderator one by one (with their reason), or by the block of its author
 * (with the block's reason). Nothing when no row says so.
 *
 * @param {Object} review - Row of AdminReviewModel.getAdminReviews
 * @returns {Object} the row with hidden_by and hidden_reason, without hidden_action
 */
const withHiddenCause = (review) => {
  const { hidden_action: action, ...rest } = review;
  const hiddenBy = action === 'review_hide' ? 'moderator' : action === 'user_block' ? 'block' : null;
  return {
    ...rest,
    hidden_by: hiddenBy,
    hidden_reason: hiddenBy ? (review.hidden_reason || null) : null,
  };
};

/**
 * A review as the viewer receives it: the way an outsider sees reviews.
 *
 * - A visible review keeps what the public card shows — the author's name and
 *   the text — and loses the e-mail (Coordinator decision 2026-09-08) and the
 *   author's id: the id leads to the person's card on «Пользователи», where
 *   the view mode has no action to take (Phase 3.5 lens review).
 * - A hidden review keeps its place in the list with the mark is_visible:
 *   false, the rating and the date, but carries nothing of the person: no
 *   id, no name, no e-mail, no author statistics, and no text — neither the author's
 *   nor the partner's reply, which may quote it. A review is often hidden
 *   precisely because its text says too much about someone.
 * - Deleted reviews never reach this function: the model drops them for a
 *   viewer in the WHERE (pack 2, point 1; cloud critic 2A, B-1).
 *
 * Keys stay, values become null: the panel's model reads every one of these
 * as nullable. viewer_redacted tells the panel the empty fields are withheld,
 * not absent — «no text, rating only» would be a false statement about the
 * review (the same as partner_data_redacted on the establishment card).
 *
 * @param {Object} review - Row of AdminReviewModel.getAdminReviews
 * @returns {Object}
 */
const toViewerReview = (review) => {
  // Whether the author is blocked, and why a review was hidden, are facts
  // about a person and the moderator's free text: not for a viewer.
  const withheld = { author_is_active: null, hidden_by: null, hidden_reason: null };
  if (review.is_visible) {
    return { ...review, ...withheld, author_id: null, author_email: null, viewer_redacted: false };
  }
  return {
    ...review,
    ...withheld,
    viewer_redacted: true,
    author_id: null,
    author_name: null,
    author_email: null,
    author_review_count: null,
    author_average_rating: null,
    content: null,
    partner_response: null,
  };
};

/**
 * Get paginated admin reviews with filters
 *
 * A viewer — the read-only panel role that may be shown to a third party —
 * gets the reviews through toViewerReview, without deleted ones, and may not
 * ask for the reviews of one person (user_id): that is a dossier, not a
 * moderation view (pack 2, point 1).
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
  rating_min,
  rating_max,
  status,
  search,
  sort = 'newest',
  from,
  to,
  viewer = false,
} = {}) => {
  if (viewer && user_id) throw refuse('VIEWER_PERSON_FILTER_FORBIDDEN', 403);
  // A person's id that is not a UUID would fail in the database as a 500.
  if (user_id !== undefined && (typeof user_id !== 'string' || !UUID_PATTERN.test(user_id))) {
    throw refuse('AUTHOR_FILTER_INVALID', 422);
  }
  const ratings = {
    rating: ratingParam(rating),
    rating_min: ratingParam(rating_min),
    rating_max: ratingParam(rating_max),
  };

  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const filters = {
      establishment_id,
      user_id,
      ...ratings,
      status,
      search,
      sort,
      from,
      to,
      viewer,
    };

    const [reviews, stats] = await Promise.all([
      AdminReviewModel.getAdminReviews(filters, effectivePerPage, offset),
      AdminReviewModel.getReviewStats(filters),
    ]);

    return {
      reviews: viewer
        ? reviews.map(withHiddenCause).map(toViewerReview)
        : reviews.map(withHiddenCause),
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
    throw refuse('REVIEWS_FETCH_FAILED', 500);
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
 * The reason is optional — a panel build from before 21.10 sends none — and
 * goes to the journal only: the author's notice does not quote it.
 *
 * @param {string} reviewId
 * @param {boolean} isVisible - true: show, false: hide
 * @param {string} adminUserId - UUID of admin performing the action
 * @param {Object} [request] - { ipAddress, userAgent, reason }
 * @returns {Promise<Object>} { id, is_visible, establishment_id, changed }
 */
export const setVisibility = async (reviewId, isVisible, adminUserId, { ipAddress, userAgent, reason: rawReason } = {}) => {
  const reason = normalizeReviewReason(rawReason);
  try {
    const review = await AdminReviewModel.getReviewForAdmin(reviewId);

    if (!review || review.is_deleted) {
      throw refuse('REVIEW_NOT_FOUND', 404);
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

    // The change, the rating and the journal entry in one transaction: the
    // entry is read back by the unblock of the author (adminUserService) —
    // a review hidden or shown one by one after a block is the moderator's
    // decision, and the unblock leaves it as it is. Lost, the entry let the
    // unblock show again the review the moderator hid (tester walkthrough
    // 17.10, P8 report, finding 4); so a failed entry now fails the change.
    const action = isVisible ? 'review_show' : 'review_hide';
    let result;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      result = await AdminReviewModel.setReviewVisibility(reviewId, isVisible, review.is_visible, client);
      if (result) {
        // Recalculate establishment aggregates (hidden reviews excluded from rating)
        await ReviewModel.updateEstablishmentAggregates(result.establishment_id, client);
        await AuditLogModel.writeAuditLogInTransaction(client, {
          user_id: adminUserId,
          action,
          entity_type: 'review',
          entity_id: reviewId,
          new_data: reason
            ? { is_visible: result.is_visible, reason }
            : { is_visible: result.is_visible },
          ip_address: ipAddress,
          user_agent: userAgent,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (!result) {
      // Changed between the read and the write — by another moderator or by a
      // repeat of this very request. Re-read: the requested state reached is
      // a success, anything else is a conflict to show.
      const current = await AdminReviewModel.getReviewForAdmin(reviewId);
      if (!current || current.is_deleted) {
        throw refuse('REVIEW_NOT_FOUND', 404);
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
      throw refuse('VISIBILITY_CONFLICT', 409);
    }

    result = { ...result, changed: true };

    // Notify review author only when hiding (non-blocking)
    if (!result.is_visible) {
      NotificationService.notifyReviewModerated(reviewId, 'hidden')
        .catch(() => {});
    }

    return result;
  } catch (error) {
    // A refusal of the service. A database error has a code too (an entry
    // that could not be written, for one), and must not leave as it is.
    if (error instanceof AppError) throw error;
    logger.error('Error in setVisibility service', {
      error: error.message,
      reviewId,
    });
    throw refuse('VISIBILITY_UPDATE_FAILED', 500);
  }
};

/**
 * Soft-delete a review, update establishment aggregates, write audit log
 *
 * @param {string} reviewId
 * @param {string} adminUserId
 * @param {string} [rawReason] - Optional reason for deletion, up to REASON_MAX_LENGTH
 * @returns {Promise<Object>} { success: true }
 */
export const deleteReview = async (reviewId, adminUserId, rawReason, { ipAddress, userAgent } = {}) => {
  const reason = normalizeReviewReason(rawReason);
  try {
    // Get review info before deletion (for establishment_id)
    const review = await AdminReviewModel.getReviewForAdmin(reviewId);

    if (!review) {
      throw refuse('REVIEW_NOT_FOUND', 404);
    }

    if (review.is_deleted) {
      throw refuse('REVIEW_ALREADY_DELETED', 400);
    }

    // Soft-delete the review
    const deleted = await ReviewModel.softDeleteReview(reviewId);

    if (!deleted) {
      throw refuse('REVIEW_DELETE_FAILED', 500);
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
        reason,
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
    throw refuse('REVIEW_DELETE_FAILED', 500);
  }
};

/**
 * Hide the chosen reviews at once, with one reason — «Скрыть выбранные» on the
 * «Отзывы» screen, made for the reviews of one person (the tester's test
 * reviews; walkthrough 20.10, A2-09).
 *
 * One transaction: the reviews still visible are hidden, the rating of every
 * establishment they belong to is recalculated, and the journal gets one
 * review_hide entry per review — the same entry a single hide writes, so the
 * unblock of an author leaves these reviews hidden as the moderator's
 * decision (adminUserService.unblockUser reads exactly that action). The
 * entries of one batch share new_data.batch_id and carry batch_size.
 *
 * A review already hidden, deleted or unknown is skipped, not refused: the
 * batch may hold reviews another moderator has handled meanwhile, and a
 * repeat of the same request must change nothing.
 *
 * @param {*} rawIds - body.review_ids
 * @param {*} rawReason - body.reason, required
 * @param {string} adminUserId
 * @param {Object} [request] - { ipAddress, userAgent }
 * @returns {Promise<{requested: number, hidden: number, skipped: number, changed: boolean, hidden_ids: string[]}>}
 */
export const hideReviewsBatch = async (rawIds, rawReason, adminUserId, { ipAddress, userAgent } = {}) => {
  if (!Array.isArray(rawIds) || rawIds.length === 0) throw refuse('BATCH_EMPTY', 422);
  if (!rawIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
    throw refuse('BATCH_INVALID_ID', 422);
  }
  const ids = [...new Set(rawIds.map((id) => id.toLowerCase()))];
  if (ids.length > HIDE_BATCH_MAX) throw refuse('BATCH_TOO_LARGE', 422);
  const reason = normalizeReviewReason(rawReason, { required: true });

  let hidden;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    hidden = await AdminReviewModel.hideVisibleReviews(client, ids);
    const establishments = [...new Set(hidden.map((row) => row.establishment_id))];
    for (const establishmentId of establishments) {
      await ReviewModel.updateEstablishmentAggregates(establishmentId, client);
    }
    const batchId = randomUUID();
    for (const row of hidden) {
      await AuditLogModel.writeAuditLogInTransaction(client, {
        user_id: adminUserId,
        action: 'review_hide',
        entity_type: 'review',
        entity_id: row.id,
        new_data: { is_visible: false, reason, batch_id: batchId, batch_size: hidden.length },
        ip_address: ipAddress,
        user_agent: userAgent,
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error in hideReviewsBatch service', { error: error.message, count: ids.length });
    throw refuse('HIDE_BATCH_FAILED', 500);
  } finally {
    client.release();
  }

  // The author learns of each hidden review the way a single hide tells them.
  for (const row of hidden) {
    NotificationService.notifyReviewModerated(row.id, 'hidden').catch(() => {});
  }

  logger.info('Admin hid reviews in a batch', {
    adminId: adminUserId,
    requested: ids.length,
    hidden: hidden.length,
  });

  return {
    requested: ids.length,
    hidden: hidden.length,
    skipped: ids.length - hidden.length,
    changed: hidden.length > 0,
    hidden_ids: hidden.map((row) => row.id),
  };
};
