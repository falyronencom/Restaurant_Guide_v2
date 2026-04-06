/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: notificationPreferencesModel.js
 *
 * Tests database-access methods using mocked pool.
 * Covers: getByUserId (with defaults), upsert, deleteByUserId.
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
    debug: jest.fn(),
  },
}));

const NotificationPreferencesModel = await import('../../models/notificationPreferencesModel.js');
const logger = (await import('../../utils/logger.js')).default;

describe('notificationPreferencesModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── getByUserId ──────────────────────────────────────────────────────

  describe('getByUserId', () => {
    test('should return existing preferences row', async () => {
      const userId = uuidv4();
      const prefsRow = {
        id: uuidv4(),
        user_id: userId,
        booking_push_enabled: true,
        reviews_push_enabled: false,
        promotions_push_enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQuery.mockResolvedValue({ rows: [prefsRow] });

      const result = await NotificationPreferencesModel.getByUserId(userId);

      expect(result).toEqual(prefsRow);
      expect(result.reviews_push_enabled).toBe(false);
    });

    test('should return defaults when no row exists', async () => {
      const userId = uuidv4();
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await NotificationPreferencesModel.getByUserId(userId);

      expect(result).toEqual({
        user_id: userId,
        booking_push_enabled: true,
        reviews_push_enabled: true,
        promotions_push_enabled: true,
      });
    });

    test('should throw and log on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      await expect(NotificationPreferencesModel.getByUserId(uuidv4())).rejects.toThrow('DB error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── upsert ───────────────────────────────────────────────────────────

  describe('upsert', () => {
    test('should insert new preferences row', async () => {
      const userId = uuidv4();
      const prefs = {
        booking_push_enabled: true,
        reviews_push_enabled: false,
        promotions_push_enabled: true,
      };
      const insertedRow = { id: uuidv4(), user_id: userId, ...prefs };

      mockQuery.mockResolvedValue({ rows: [insertedRow] });

      const result = await NotificationPreferencesModel.upsert(userId, prefs);

      expect(result).toEqual(insertedRow);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notification_preferences'),
        [userId, true, false, true]
      );
    });

    test('should handle partial update — undefined fields passed as null', async () => {
      const userId = uuidv4();
      const prefs = { booking_push_enabled: false };
      const updatedRow = {
        id: uuidv4(),
        user_id: userId,
        booking_push_enabled: false,
        reviews_push_enabled: true,
        promotions_push_enabled: true,
      };

      mockQuery.mockResolvedValue({ rows: [updatedRow] });

      const result = await NotificationPreferencesModel.upsert(userId, prefs);

      expect(result.booking_push_enabled).toBe(false);
      // Undefined fields → null via ?? null
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        [userId, false, null, null]
      );
    });

    test('should throw and log on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      await expect(
        NotificationPreferencesModel.upsert(uuidv4(), { booking_push_enabled: true })
      ).rejects.toThrow('DB error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── deleteByUserId ───────────────────────────────────────────────────

  describe('deleteByUserId', () => {
    test('should delete preferences for user', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await NotificationPreferencesModel.deleteByUserId(uuidv4());

      expect(result).toBe(1);
    });

    test('should return 0 if no preferences existed', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await NotificationPreferencesModel.deleteByUserId(uuidv4());

      expect(result).toBe(0);
    });
  });
});
