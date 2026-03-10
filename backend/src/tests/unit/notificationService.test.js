/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: notificationService.js
 *
 * Tests core methods and trigger helpers in isolation.
 * Trigger helpers are NON-BLOCKING — they catch errors internally
 * and must never propagate to the caller.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
jest.unstable_mockModule('../../models/notificationModel.js', () => ({
  create: jest.fn(),
  getByUserId: jest.fn(),
  getUnreadCount: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteOld: jest.fn(),
}));

jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  findEstablishmentById: jest.fn(),
}));

jest.unstable_mockModule('../../models/reviewModel.js', () => ({
  findReviewById: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
const NotificationModel = await import('../../models/notificationModel.js');
const EstablishmentModel = await import('../../models/establishmentModel.js');
const ReviewModel = await import('../../models/reviewModel.js');
const logger = (await import('../../utils/logger.js')).default;

const {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  notifyEstablishmentStatusChange,
  notifyNewReview,
  notifyPartnerResponse,
  notifyReviewModerated,
} = await import('../../services/notificationService.js');

import { createMockEstablishment, createMockReview } from '../mocks/helpers.js';

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Core methods
  // ═══════════════════════════════════════════════════════════════════════

  describe('createNotification', () => {
    test('should create notification with valid data', async () => {
      const data = {
        userId: uuidv4(),
        type: 'new_review',
        title: 'Новый отзыв',
        message: 'Новый отзыв на «Test»',
        establishmentId: uuidv4(),
        reviewId: uuidv4(),
      };

      const created = { id: uuidv4(), ...data };
      NotificationModel.create.mockResolvedValue(created);

      const result = await createNotification(data);

      expect(result).toEqual(created);
      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        establishmentId: data.establishmentId,
        reviewId: data.reviewId,
      });
    });

    test('should throw error when userId is missing', async () => {
      await expect(
        createNotification({ type: 'new_review', title: 'Test' })
      ).rejects.toThrow('userId, type, and title are required');

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should throw error when type is missing', async () => {
      await expect(
        createNotification({ userId: uuidv4(), title: 'Test' })
      ).rejects.toThrow('userId, type, and title are required');
    });

    test('should throw error when title is missing', async () => {
      await expect(
        createNotification({ userId: uuidv4(), type: 'new_review' })
      ).rejects.toThrow('userId, type, and title are required');
    });

    test('should throw error for invalid notification type', async () => {
      await expect(
        createNotification({
          userId: uuidv4(),
          type: 'invalid_type',
          title: 'Test',
        })
      ).rejects.toThrow('Invalid notification type: invalid_type');

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should accept all valid notification types', async () => {
      const validTypes = [
        'establishment_approved',
        'establishment_rejected',
        'establishment_suspended',
        'establishment_unsuspended',
        'new_review',
        'partner_response',
        'review_hidden',
        'review_deleted',
      ];

      for (const type of validTypes) {
        NotificationModel.create.mockResolvedValue({ id: uuidv4() });

        await expect(
          createNotification({ userId: uuidv4(), type, title: 'Test' })
        ).resolves.toBeDefined();
      }

      expect(NotificationModel.create).toHaveBeenCalledTimes(validTypes.length);
    });
  });

  describe('getUserNotifications', () => {
    const userId = uuidv4();

    test('should return paginated results with defaults', async () => {
      const modelResult = {
        items: [{ id: uuidv4(), type: 'new_review' }],
        total: 1,
      };
      NotificationModel.getByUserId.mockResolvedValue(modelResult);

      const result = await getUserNotifications(userId);

      expect(result).toEqual({
        items: modelResult.items,
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
      });
      expect(NotificationModel.getByUserId).toHaveBeenCalledWith(userId, {
        limit: 20,
        offset: 0,
      });
    });

    test('should calculate offset from page and limit', async () => {
      NotificationModel.getByUserId.mockResolvedValue({ items: [], total: 50 });

      const result = await getUserNotifications(userId, { page: 3, limit: 10 });

      expect(NotificationModel.getByUserId).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ limit: 10, offset: 20 })
      );
      expect(result.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 50,
        pages: 5,
      });
    });

    test('should pass is_read filter when boolean', async () => {
      NotificationModel.getByUserId.mockResolvedValue({ items: [], total: 0 });

      await getUserNotifications(userId, { is_read: false });

      expect(NotificationModel.getByUserId).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ isRead: false })
      );
    });

    test('should pass category filter', async () => {
      NotificationModel.getByUserId.mockResolvedValue({ items: [], total: 0 });

      await getUserNotifications(userId, { category: 'establishments' });

      expect(NotificationModel.getByUserId).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ category: 'establishments' })
      );
    });

    test('should calculate pages correctly (ceil)', async () => {
      NotificationModel.getByUserId.mockResolvedValue({ items: [], total: 21 });

      const result = await getUserNotifications(userId, { page: 1, limit: 10 });

      expect(result.pagination.pages).toBe(3);
    });

    test('should return 0 pages for empty results', async () => {
      NotificationModel.getByUserId.mockResolvedValue({ items: [], total: 0 });

      const result = await getUserNotifications(userId);

      expect(result.pagination.pages).toBe(0);
    });
  });

  describe('getUnreadCount', () => {
    test('should pass through to model', async () => {
      NotificationModel.getUnreadCount.mockResolvedValue(5);

      const result = await getUnreadCount('user-1');

      expect(result).toBe(5);
      expect(NotificationModel.getUnreadCount).toHaveBeenCalledWith('user-1');
    });
  });

  describe('markAsRead', () => {
    test('should pass through to model', async () => {
      const updated = { id: 'notif-1', is_read: true };
      NotificationModel.markAsRead.mockResolvedValue(updated);

      const result = await markAsRead('notif-1', 'user-1');

      expect(result).toEqual(updated);
      expect(NotificationModel.markAsRead).toHaveBeenCalledWith('notif-1', 'user-1');
    });
  });

  describe('markAllAsRead', () => {
    test('should pass through to model', async () => {
      NotificationModel.markAllAsRead.mockResolvedValue(3);

      const result = await markAllAsRead('user-1');

      expect(result).toBe(3);
      expect(NotificationModel.markAllAsRead).toHaveBeenCalledWith('user-1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Trigger helpers (NON-BLOCKING)
  // ═══════════════════════════════════════════════════════════════════════

  describe('notifyEstablishmentStatusChange', () => {
    const establishmentId = uuidv4();
    const partnerId = uuidv4();

    const mockEstablishment = createMockEstablishment({
      id: establishmentId,
      partner_id: partnerId,
      name: 'Кафе Тест',
    });

    beforeEach(() => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should create notification for approved status', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'active');

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: partnerId,
        type: 'establishment_approved',
        title: 'Заведение одобрено',
        message: '«Кафе Тест» одобрено модерацией',
        establishmentId,
      });
    });

    test('should create notification for rejected status with reason', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'rejected', 'Плохие фото');

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'establishment_rejected',
          title: 'Заведение отклонено',
          message: '«Кафе Тест» отклонено: Плохие фото',
        })
      );
    });

    test('should create notification for rejected status without reason', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'rejected');

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '«Кафе Тест» отклонено модерацией',
        })
      );
    });

    test('should create notification for suspended status with reason', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'suspended', 'Жалобы');

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'establishment_suspended',
          title: 'Заведение приостановлено',
          message: '«Кафе Тест» приостановлено: Жалобы',
        })
      );
    });

    test('should do nothing for unknown status', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'draft');

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should do nothing when establishment not found', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await notifyEstablishmentStatusChange(establishmentId, 'active');

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should do nothing when establishment has no partner_id', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        partner_id: null,
      });

      await notifyEstablishmentStatusChange(establishmentId, 'active');

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should NOT throw on error (non-blocking)', async () => {
      EstablishmentModel.findEstablishmentById.mockRejectedValue(
        new Error('DB down')
      );

      // Should NOT throw
      await expect(
        notifyEstablishmentStatusChange(establishmentId, 'active')
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create establishment status notification',
        expect.objectContaining({ establishmentId, newStatus: 'active' })
      );
    });

    test('should use "Заведение" as fallback name', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        name: null,
      });

      await notifyEstablishmentStatusChange(establishmentId, 'active');

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '«Заведение» одобрено модерацией',
        })
      );
    });

    // --- Fix 1: field-level rejection reason extraction ---

    test('should extract rejection reason from moderation_notes object with "rejected:" field', async () => {
      const moderationNotes = {
        name: 'approved',
        description: 'rejected: текст слишком короткий',
        address: 'approved',
      };

      await notifyEstablishmentStatusChange(establishmentId, 'rejected', moderationNotes);

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'establishment_rejected',
          title: 'Заведение отклонено',
          message: '«Кафе Тест» отклонено: текст слишком короткий',
        })
      );
    });

    test('should use rejection_reason key from moderation_notes if present', async () => {
      const moderationNotes = {
        rejection_reason: 'Общая причина отказа',
        name: 'rejected: имя не подходит',
      };

      await notifyEstablishmentStatusChange(establishmentId, 'rejected', moderationNotes);

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '«Кафе Тест» отклонено: Общая причина отказа',
        })
      );
    });

    test('should fall back to generic message when moderation_notes has no rejections', async () => {
      const moderationNotes = {
        name: 'approved',
        description: 'approved',
      };

      await notifyEstablishmentStatusChange(establishmentId, 'rejected', moderationNotes);

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '«Кафе Тест» отклонено модерацией',
        })
      );
    });

    test('should fall back to generic message when moderation_notes is empty object', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'rejected', {});

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '«Кафе Тест» отклонено модерацией',
        })
      );
    });

    // --- Fix 2: unsuspend notification ---

    test('should create notification for unsuspended status', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'unsuspended');

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: partnerId,
        type: 'establishment_unsuspended',
        title: 'Заведение возобновлено',
        message: '«Кафе Тест» снова активно',
        establishmentId,
      });
    });
  });

  describe('notifyNewReview', () => {
    const reviewId = uuidv4();
    const establishmentId = uuidv4();
    const partnerId = uuidv4();

    const mockEstablishment = createMockEstablishment({
      id: establishmentId,
      partner_id: partnerId,
      name: 'Ресторан Прага',
    });

    beforeEach(() => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should notify partner about new review', async () => {
      await notifyNewReview(reviewId, establishmentId);

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: partnerId,
        type: 'new_review',
        title: 'Новый отзыв',
        message: 'Новый отзыв на «Ресторан Прага»',
        establishmentId,
        reviewId,
      });
    });

    test('should do nothing when establishment not found', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await notifyNewReview(reviewId, establishmentId);

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should do nothing when no partner_id', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        ...mockEstablishment,
        partner_id: null,
      });

      await notifyNewReview(reviewId, establishmentId);

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should NOT throw on error (non-blocking)', async () => {
      NotificationModel.create.mockRejectedValue(new Error('Insert failed'));

      await expect(
        notifyNewReview(reviewId, establishmentId)
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create new review notification',
        expect.objectContaining({ reviewId, establishmentId })
      );
    });
  });

  describe('notifyPartnerResponse', () => {
    const reviewId = uuidv4();
    const establishmentId = uuidv4();
    const reviewUserId = uuidv4();

    const mockReview = createMockReview({
      id: reviewId,
      user_id: reviewUserId,
      establishment_id: establishmentId,
    });

    const mockEstablishment = createMockEstablishment({
      id: establishmentId,
      name: 'Бар Минск',
    });

    beforeEach(() => {
      ReviewModel.findReviewById.mockResolvedValue(mockReview);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should notify review author about partner response', async () => {
      await notifyPartnerResponse(reviewId, establishmentId);

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: reviewUserId,
        type: 'partner_response',
        title: 'Ответ на ваш отзыв',
        message: 'Владелец «Бар Минск» ответил на ваш отзыв',
        establishmentId,
        reviewId,
      });
    });

    test('should do nothing when review not found', async () => {
      ReviewModel.findReviewById.mockResolvedValue(null);

      await notifyPartnerResponse(reviewId, establishmentId);

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should do nothing when review has no user_id', async () => {
      ReviewModel.findReviewById.mockResolvedValue({ ...mockReview, user_id: null });

      await notifyPartnerResponse(reviewId, establishmentId);

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should use "Заведение" fallback when establishment not found', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await notifyPartnerResponse(reviewId, establishmentId);

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Владелец «Заведение» ответил на ваш отзыв',
        })
      );
    });

    test('should NOT throw on error (non-blocking)', async () => {
      ReviewModel.findReviewById.mockRejectedValue(new Error('DB error'));

      await expect(
        notifyPartnerResponse(reviewId, establishmentId)
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create partner response notification',
        expect.objectContaining({ reviewId, establishmentId })
      );
    });
  });

  describe('notifyReviewModerated', () => {
    const reviewId = uuidv4();
    const reviewUserId = uuidv4();
    const establishmentId = uuidv4();

    const mockReview = createMockReview({
      id: reviewId,
      user_id: reviewUserId,
      establishment_id: establishmentId,
    });

    const mockEstablishment = createMockEstablishment({
      id: establishmentId,
      name: 'Пиццерия',
    });

    beforeEach(() => {
      ReviewModel.findReviewById.mockResolvedValue(mockReview);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should notify about hidden review', async () => {
      await notifyReviewModerated(reviewId, 'hidden');

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: reviewUserId,
        type: 'review_hidden',
        title: 'Отзыв скрыт модератором',
        message: 'Ваш отзыв на «Пиццерия» скрыт модератором',
        establishmentId,
        reviewId,
      });
    });

    test('should notify about deleted review', async () => {
      await notifyReviewModerated(reviewId, 'deleted');

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: reviewUserId,
        type: 'review_deleted',
        title: 'Отзыв удалён модератором',
        message: 'Ваш отзыв на «Пиццерия» удалён модератором',
        establishmentId,
        reviewId,
      });
    });

    test('should do nothing when review not found', async () => {
      ReviewModel.findReviewById.mockResolvedValue(null);

      await notifyReviewModerated(reviewId, 'hidden');

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should do nothing when review has no user_id', async () => {
      ReviewModel.findReviewById.mockResolvedValue({ ...mockReview, user_id: null });

      await notifyReviewModerated(reviewId, 'deleted');

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('should use "Заведение" fallback when establishment not found', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await notifyReviewModerated(reviewId, 'hidden');

      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Ваш отзыв на «Заведение» скрыт модератором',
        })
      );
    });

    test('should NOT throw on error (non-blocking)', async () => {
      ReviewModel.findReviewById.mockRejectedValue(new Error('DB error'));

      await expect(
        notifyReviewModerated(reviewId, 'hidden')
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create review moderation notification',
        expect.objectContaining({ reviewId, action: 'hidden' })
      );
    });
  });
});
