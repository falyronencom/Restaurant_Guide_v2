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

jest.unstable_mockModule('../../models/favoriteModel.js', () => ({
  getUserIdsByEstablishment: jest.fn(),
}));

jest.unstable_mockModule('../../models/menuItemModel.js', () => ({
  findById: jest.fn(),
}));

jest.unstable_mockModule('../../services/pushService.js', () => ({
  sendPush: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import after mocking
const NotificationModel = await import('../../models/notificationModel.js');
const EstablishmentModel = await import('../../models/establishmentModel.js');
const ReviewModel = await import('../../models/reviewModel.js');
const FavoriteModel = await import('../../models/favoriteModel.js');
const MenuItemModel = await import('../../models/menuItemModel.js');
const PushService = await import('../../services/pushService.js');
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
  notifyEstablishmentClaimed,
  notifyBookingReceived,
  notifyBookingConfirmed,
  notifyBookingDeclined,
  notifyBookingExpired,
  notifyBookingCancelled,
  notifyPromotionNew,
  notifyMenuParsed,
  notifyMenuItemHidden,
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
        'establishment_claimed',
        'booking_received',
        'booking_confirmed',
        'booking_declined',
        'booking_expired',
        'booking_cancelled',
        'promotion_new',
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

    test('should NOT call pushService for review_hidden (in-app only)', async () => {
      await notifyReviewModerated(reviewId, 'hidden');
      expect(PushService.sendPush).not.toHaveBeenCalled();
    });

    test('should NOT call pushService for review_deleted (in-app only)', async () => {
      await notifyReviewModerated(reviewId, 'deleted');
      expect(PushService.sendPush).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Push integration in trigger helpers
  // ═══════════════════════════════════════════════════════════════════════

  describe('push integration — establishment status', () => {
    const establishmentId = uuidv4();
    const partnerId = uuidv4();

    beforeEach(() => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(
        createMockEstablishment({ id: establishmentId, partner_id: partnerId, name: 'Тест' })
      );
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should call pushService for approved', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'active');
      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          title: 'Заведение одобрено',
          data: expect.objectContaining({ type: 'establishment_approved', establishmentId }),
        })
      );
    });

    test('should call pushService for rejected', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'rejected', 'Причина');
      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'establishment_rejected' }),
        })
      );
    });

    test('should call pushService for suspended', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'suspended');
      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'establishment_suspended' }),
        })
      );
    });

    test('should call pushService for unsuspended', async () => {
      await notifyEstablishmentStatusChange(establishmentId, 'unsuspended');
      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'establishment_unsuspended' }),
        })
      );
    });
  });

  describe('push integration — reviews', () => {
    const reviewId = uuidv4();
    const establishmentId = uuidv4();
    const partnerId = uuidv4();
    const reviewUserId = uuidv4();

    beforeEach(() => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(
        createMockEstablishment({ id: establishmentId, partner_id: partnerId, name: 'Бар' })
      );
      ReviewModel.findReviewById.mockResolvedValue(
        createMockReview({ id: reviewId, user_id: reviewUserId, establishment_id: establishmentId })
      );
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should call pushService for new review', async () => {
      await notifyNewReview(reviewId, establishmentId);
      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'new_review', establishmentId, reviewId }),
        })
      );
    });

    test('should call pushService for partner response', async () => {
      await notifyPartnerResponse(reviewId, establishmentId);
      expect(PushService.sendPush).toHaveBeenCalledWith(
        reviewUserId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'partner_response', establishmentId, reviewId }),
        })
      );
    });
  });

  describe('push integration — no push for claimed', () => {
    test('should NOT call pushService for establishment_claimed', async () => {
      const establishmentId = uuidv4();
      const newPartnerId = uuidv4();
      EstablishmentModel.findEstablishmentById.mockResolvedValue(
        createMockEstablishment({ id: establishmentId, name: 'Кафе' })
      );
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });

      await notifyEstablishmentClaimed(establishmentId, newPartnerId);

      expect(NotificationModel.create).toHaveBeenCalled();
      expect(PushService.sendPush).not.toHaveBeenCalled();
    });
  });

  describe('push integration — bookings', () => {
    const establishmentId = uuidv4();
    const partnerId = uuidv4();
    const userId = uuidv4();
    const bookingData = {
      id: uuidv4(),
      establishment_name: 'Ресторан',
      booking_date: '2026-04-10',
      booking_time: '19:00:00',
      guest_count: 4,
    };

    beforeEach(() => {
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should call pushService for booking_received', async () => {
      await notifyBookingReceived(partnerId, bookingData, establishmentId);
      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'booking_received', establishmentId }),
        })
      );
    });

    test('should call pushService for booking_confirmed', async () => {
      await notifyBookingConfirmed(userId, bookingData, establishmentId);
      expect(PushService.sendPush).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'booking_confirmed' }),
        })
      );
    });

    test('should call pushService for booking_declined', async () => {
      await notifyBookingDeclined(userId, bookingData, establishmentId, 'Нет мест');
      expect(PushService.sendPush).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'booking_declined' }),
        })
      );
    });

    test('should call pushService for BOTH recipients on booking_expired', async () => {
      // Debug: check NotificationModel.create call count before
      const createBefore = NotificationModel.create.mock.calls.length;
      await notifyBookingExpired(userId, partnerId, bookingData, establishmentId);
      const createAfter = NotificationModel.create.mock.calls.length;

      // Expired creates 2 in-app notifications
      expect(createAfter - createBefore).toBe(2);

      // Push should be called for both user and partner
      const pushCalls = PushService.sendPush.mock.calls;
      const expiredPushCalls = pushCalls.filter(
        (c) => c[1] && c[1].data && c[1].data.type === 'booking_expired'
      );
      expect(expiredPushCalls.length).toBe(2);

      const pushUserIds = expiredPushCalls.map((c) => c[0]);
      expect(pushUserIds).toContain(userId);
      expect(pushUserIds).toContain(partnerId);
    });

    test('should call pushService for booking_cancelled', async () => {
      await notifyBookingCancelled(partnerId, bookingData, establishmentId);
      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          data: expect.objectContaining({ type: 'booking_cancelled' }),
        })
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // notifyPromotionNew
  // ═══════════════════════════════════════════════════════════════════════

  describe('notifyPromotionNew', () => {
    const establishmentId = uuidv4();

    beforeEach(() => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(
        createMockEstablishment({ id: establishmentId, name: 'Пиццерия Люкс' })
      );
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });
    });

    test('should create notifications for all users who favorited', async () => {
      const userIds = [uuidv4(), uuidv4(), uuidv4()];
      FavoriteModel.getUserIdsByEstablishment.mockResolvedValue(userIds);

      await notifyPromotionNew(establishmentId, 'Скидка 20%');

      expect(NotificationModel.create).toHaveBeenCalledTimes(3);
      expect(PushService.sendPush).toHaveBeenCalledTimes(3);

      userIds.forEach((uid) => {
        expect(NotificationModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: uid,
            type: 'promotion_new',
            title: 'Новая акция',
            message: 'Новая акция в «Пиццерия Люкс»: Скидка 20%',
            establishmentId,
          })
        );
        expect(PushService.sendPush).toHaveBeenCalledWith(
          uid,
          expect.objectContaining({
            data: expect.objectContaining({ type: 'promotion_new', establishmentId }),
          })
        );
      });
    });

    test('should do nothing when no favorites exist', async () => {
      FavoriteModel.getUserIdsByEstablishment.mockResolvedValue([]);

      await notifyPromotionNew(establishmentId, 'Акция');

      expect(NotificationModel.create).not.toHaveBeenCalled();
      expect(PushService.sendPush).not.toHaveBeenCalled();
    });

    test('should do nothing when establishment not found', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await notifyPromotionNew(establishmentId, 'Акция');

      expect(FavoriteModel.getUserIdsByEstablishment).not.toHaveBeenCalled();
    });

    test('should continue despite individual failures (Promise.allSettled)', async () => {
      const userIds = [uuidv4(), uuidv4()];
      FavoriteModel.getUserIdsByEstablishment.mockResolvedValue(userIds);
      // First create succeeds, second fails
      NotificationModel.create
        .mockResolvedValueOnce({ id: uuidv4() })
        .mockRejectedValueOnce(new Error('DB error'));

      // Should NOT throw
      await expect(
        notifyPromotionNew(establishmentId, 'Акция')
      ).resolves.toBeUndefined();

      // Both create calls were attempted
      expect(NotificationModel.create).toHaveBeenCalledTimes(2);
    });

    test('should NOT throw on error (non-blocking)', async () => {
      FavoriteModel.getUserIdsByEstablishment.mockRejectedValue(new Error('DB error'));

      await expect(
        notifyPromotionNew(establishmentId, 'Акция')
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create promotion notifications',
        expect.objectContaining({ establishmentId })
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Segment B: menu-related helpers
  // ═══════════════════════════════════════════════════════════════════════

  describe('notifyMenuParsed', () => {
    const establishmentId = uuidv4();
    const partnerId = uuidv4();

    test('creates in-app notification with item count in message', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        id: establishmentId,
        partner_id: partnerId,
        name: 'Кофе Плюс',
      });
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });

      await notifyMenuParsed(establishmentId, 42);

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: partnerId,
        type: 'menu_parsed',
        title: 'Меню распознано',
        message: expect.stringContaining('42'),
        establishmentId,
      });
    });

    test('does NOT send push (per directive: non-urgent)', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        id: establishmentId,
        partner_id: partnerId,
        name: 'Кофе Плюс',
      });
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });

      await notifyMenuParsed(establishmentId, 5);

      expect(PushService.sendPush).not.toHaveBeenCalled();
    });

    test('skips when establishment has no partner_id', async () => {
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        id: establishmentId,
        partner_id: null,
        name: 'Тест',
      });

      await notifyMenuParsed(establishmentId, 10);

      expect(NotificationModel.create).not.toHaveBeenCalled();
    });

    test('does NOT throw on DB error (non-blocking)', async () => {
      EstablishmentModel.findEstablishmentById.mockRejectedValue(new Error('DB down'));

      await expect(notifyMenuParsed(establishmentId, 5)).resolves.toBeUndefined();
    });
  });

  describe('notifyMenuItemHidden', () => {
    const menuItemId = uuidv4();
    const partnerId = uuidv4();
    const establishmentId = uuidv4();

    test('creates in-app notification and sends push', async () => {
      MenuItemModel.findById.mockResolvedValue({
        id: menuItemId,
        establishment_id: establishmentId,
        item_name: 'Эспрессо',
      });
      EstablishmentModel.findEstablishmentById.mockResolvedValue({
        id: establishmentId,
        name: 'Кофе Плюс',
        partner_id: partnerId,
      });
      NotificationModel.create.mockResolvedValue({ id: uuidv4() });

      await notifyMenuItemHidden(menuItemId, partnerId, 'нецензурное название');

      expect(NotificationModel.create).toHaveBeenCalledWith({
        userId: partnerId,
        type: 'menu_item_hidden_by_admin',
        title: 'Позиция меню скрыта модератором',
        message: expect.stringContaining('Эспрессо'),
        establishmentId,
      });

      expect(PushService.sendPush).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          title: 'Позиция меню скрыта модератором',
          data: expect.objectContaining({
            type: 'menu_item_hidden_by_admin',
            menuItemId,
          }),
        })
      );
    });

    test('skips when menu item not found', async () => {
      MenuItemModel.findById.mockResolvedValue(null);

      await notifyMenuItemHidden(menuItemId, partnerId, 'reason');

      expect(NotificationModel.create).not.toHaveBeenCalled();
      expect(PushService.sendPush).not.toHaveBeenCalled();
    });

    test('does NOT throw on error (non-blocking)', async () => {
      MenuItemModel.findById.mockRejectedValue(new Error('DB failure'));

      await expect(
        notifyMenuItemHidden(menuItemId, partnerId, 'reason')
      ).resolves.toBeUndefined();
    });
  });
});
