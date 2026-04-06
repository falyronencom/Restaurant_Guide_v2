/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: notificationModel.js
 *
 * Tests all database-access methods using mocked pool.
 * Covers: create, getByUserId, getUnreadCount, markAsRead, markAllAsRead, deleteOld.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// Mock pool
const mockQuery = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  default: {
    query: mockQuery,
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const NotificationModel = await import('../../models/notificationModel.js');
const logger = (await import('../../utils/logger.js')).default;

describe('notificationModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    const baseData = {
      userId: uuidv4(),
      type: 'new_review',
      title: 'Новый отзыв',
      message: 'Новый отзыв на «Test»',
      establishmentId: uuidv4(),
      reviewId: uuidv4(),
    };

    test('should insert notification and return created row', async () => {
      const createdRow = {
        id: uuidv4(),
        user_id: baseData.userId,
        type: baseData.type,
        title: baseData.title,
        message: baseData.message,
        establishment_id: baseData.establishmentId,
        review_id: baseData.reviewId,
        is_read: false,
        created_at: new Date(),
      };

      mockQuery.mockResolvedValue({ rows: [createdRow] });

      const result = await NotificationModel.create(baseData);

      expect(result).toEqual(createdRow);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        [
          baseData.userId,
          baseData.type,
          baseData.title,
          baseData.message,
          baseData.establishmentId,
          baseData.reviewId,
        ]
      );
    });

    test('should use null for optional fields when not provided', async () => {
      const minimalData = {
        userId: uuidv4(),
        type: 'establishment_approved',
        title: 'Заведение одобрено',
      };

      mockQuery.mockResolvedValue({ rows: [{ id: uuidv4() }] });

      await NotificationModel.create(minimalData);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        [minimalData.userId, minimalData.type, minimalData.title, null, null, null]
      );
    });

    test('should throw and log on database error', async () => {
      const error = new Error('DB connection failed');
      mockQuery.mockRejectedValue(error);

      await expect(NotificationModel.create(baseData)).rejects.toThrow('DB connection failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Error creating notification',
        expect.objectContaining({ userId: baseData.userId, type: baseData.type })
      );
    });
  });

  // ─── getByUserId ────────────────────────────────────────────────────────

  describe('getByUserId', () => {
    const userId = uuidv4();

    test('should return paginated notifications with defaults', async () => {
      const items = [
        { id: uuidv4(), type: 'new_review', title: 'Новый отзыв', is_read: false },
        { id: uuidv4(), type: 'establishment_approved', title: 'Одобрено', is_read: true },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '5' }] }) // count query
        .mockResolvedValueOnce({ rows: items }); // data query

      const result = await NotificationModel.getByUserId(userId);

      expect(result).toEqual({ items, total: 5 });
      // Count query
      expect(mockQuery.mock.calls[0][0]).toContain('COUNT(*)');
      expect(mockQuery.mock.calls[0][1]).toEqual([userId]);
      // Data query with default limit=20, offset=0
      expect(mockQuery.mock.calls[1][0]).toContain('ORDER BY n.created_at DESC');
      expect(mockQuery.mock.calls[1][1]).toEqual([userId, 20, 0]);
    });

    test('should apply isRead filter', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '2' }] })
        .mockResolvedValueOnce({ rows: [] });

      await NotificationModel.getByUserId(userId, { isRead: false });

      // Both queries should include is_read condition
      expect(mockQuery.mock.calls[0][0]).toContain('n.is_read = $2');
      expect(mockQuery.mock.calls[0][1]).toEqual([userId, false]);
    });

    test('should apply category filter for establishments', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [] });

      await NotificationModel.getByUserId(userId, { category: 'establishments' });

      // Should include IN clause with establishment-related types
      expect(mockQuery.mock.calls[0][0]).toContain('n.type IN');
      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain('establishment_approved');
      expect(params).toContain('establishment_rejected');
      expect(params).toContain('establishment_suspended');
      expect(params).toContain('establishment_unsuspended');
      expect(params).toContain('establishment_claimed');
    });

    test('should apply category filter for reviews', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [] });

      await NotificationModel.getByUserId(userId, { category: 'reviews' });

      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain('new_review');
      expect(params).toContain('partner_response');
      expect(params).toContain('review_hidden');
      expect(params).toContain('review_deleted');
    });

    test('should apply custom limit and offset', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '50' }] })
        .mockResolvedValueOnce({ rows: [] });

      await NotificationModel.getByUserId(userId, { limit: 10, offset: 20 });

      const dataParams = mockQuery.mock.calls[1][1];
      expect(dataParams).toContain(10);
      expect(dataParams).toContain(20);
    });

    test('should return empty results', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await NotificationModel.getByUserId(userId);

      expect(result).toEqual({ items: [], total: 0 });
    });

    test('should combine isRead and category filters', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [] });

      await NotificationModel.getByUserId(userId, {
        isRead: true,
        category: 'reviews',
      });

      const query = mockQuery.mock.calls[0][0];
      expect(query).toContain('n.is_read = $2');
      expect(query).toContain('n.type IN');
    });

    test('should throw and log on database error', async () => {
      mockQuery.mockRejectedValue(new Error('Query failed'));

      await expect(NotificationModel.getByUserId(userId)).rejects.toThrow('Query failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Error fetching notifications',
        expect.objectContaining({ userId })
      );
    });
  });

  // ─── getUnreadCount ─────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    const userId = uuidv4();

    test('should return unread count', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '7' }] });

      const result = await NotificationModel.getUnreadCount(userId);

      expect(result).toBe(7);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_read = FALSE'),
        [userId]
      );
    });

    test('should return 0 when no unread notifications', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '0' }] });

      const result = await NotificationModel.getUnreadCount(userId);

      expect(result).toBe(0);
    });

    test('should throw and log on database error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      await expect(NotificationModel.getUnreadCount(userId)).rejects.toThrow('DB error');
      expect(logger.error).toHaveBeenCalledWith(
        'Error getting unread count',
        expect.objectContaining({ userId })
      );
    });
  });

  // ─── markAsRead ─────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    const notificationId = uuidv4();
    const userId = uuidv4();

    test('should mark notification as read and return updated row', async () => {
      const updated = { id: notificationId, is_read: true };
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await NotificationModel.markAsRead(notificationId, userId);

      expect(result).toEqual(updated);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SET is_read = TRUE'),
        [notificationId, userId]
      );
    });

    test('should return null when notification not found or not owned', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await NotificationModel.markAsRead(notificationId, userId);

      expect(result).toBeNull();
    });

    test('should enforce ownership via WHERE clause', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await NotificationModel.markAsRead(notificationId, userId);

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('id = $1');
      expect(sql).toContain('user_id = $2');
    });

    test('should throw and log on database error', async () => {
      mockQuery.mockRejectedValue(new Error('Update failed'));

      await expect(
        NotificationModel.markAsRead(notificationId, userId)
      ).rejects.toThrow('Update failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Error marking notification as read',
        expect.objectContaining({ notificationId, userId })
      );
    });
  });

  // ─── markAllAsRead ──────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    const userId = uuidv4();

    test('should mark all unread as read and return count', async () => {
      mockQuery.mockResolvedValue({ rowCount: 5 });

      const result = await NotificationModel.markAllAsRead(userId);

      expect(result).toBe(5);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SET is_read = TRUE'),
        [userId]
      );
    });

    test('should return 0 when nothing to mark', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await NotificationModel.markAllAsRead(userId);

      expect(result).toBe(0);
    });

    test('should only update unread notifications', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      await NotificationModel.markAllAsRead(userId);

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('is_read = FALSE');
    });

    test('should throw and log on database error', async () => {
      mockQuery.mockRejectedValue(new Error('Bulk update failed'));

      await expect(NotificationModel.markAllAsRead(userId)).rejects.toThrow('Bulk update failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Error marking all as read',
        expect.objectContaining({ userId })
      );
    });
  });

  // ─── deleteOld ──────────────────────────────────────────────────────────

  describe('deleteOld', () => {
    test('should delete notifications older than threshold', async () => {
      mockQuery.mockResolvedValue({ rowCount: 42 });

      const result = await NotificationModel.deleteOld(90);

      expect(result).toBe(42);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INTERVAL '1 day' * $1"),
        [90]
      );
    });

    test('should return 0 when nothing to delete', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await NotificationModel.deleteOld(30);

      expect(result).toBe(0);
    });

    test('should log cleanup result', async () => {
      mockQuery.mockResolvedValue({ rowCount: 10 });

      await NotificationModel.deleteOld(60);

      expect(logger.info).toHaveBeenCalledWith(
        'Old notifications cleaned up',
        expect.objectContaining({ deleted: 10, daysThreshold: 60 })
      );
    });

    test('should throw and log on database error', async () => {
      mockQuery.mockRejectedValue(new Error('Delete failed'));

      await expect(NotificationModel.deleteOld(90)).rejects.toThrow('Delete failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Error deleting old notifications',
        expect.objectContaining({ daysThreshold: 90 })
      );
    });
  });
});
