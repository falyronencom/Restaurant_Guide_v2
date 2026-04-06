/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: deviceTokenModel.js
 *
 * Tests all database-access methods using mocked pool.
 * Covers: create (UPSERT), findByUserId, deactivate, deactivateForUser, deleteByUserId.
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

const DeviceTokenModel = await import('../../models/deviceTokenModel.js');
const logger = (await import('../../utils/logger.js')).default;

describe('deviceTokenModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── create (UPSERT) ──────────────────────────────────────────────────

  describe('create', () => {
    const baseData = {
      userId: uuidv4(),
      fcmToken: 'fcm-token-abc123',
      platform: 'android',
      deviceName: 'Pixel 7',
    };

    test('should insert new token and return created row', async () => {
      const createdRow = {
        id: uuidv4(),
        user_id: baseData.userId,
        fcm_token: baseData.fcmToken,
        platform: baseData.platform,
        device_name: baseData.deviceName,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQuery.mockResolvedValue({ rows: [createdRow] });

      const result = await DeviceTokenModel.create(baseData);

      expect(result).toEqual(createdRow);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO device_tokens'),
        [baseData.userId, baseData.fcmToken, baseData.platform, baseData.deviceName]
      );
    });

    test('should handle UPSERT — ON CONFLICT reactivates token', async () => {
      const reactivatedRow = {
        id: uuidv4(),
        user_id: baseData.userId,
        fcm_token: baseData.fcmToken,
        platform: baseData.platform,
        device_name: baseData.deviceName,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQuery.mockResolvedValue({ rows: [reactivatedRow] });

      const result = await DeviceTokenModel.create(baseData);

      expect(result.is_active).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array)
      );
    });

    test('should accept null deviceName', async () => {
      const data = { ...baseData, deviceName: null };
      mockQuery.mockResolvedValue({ rows: [{ id: uuidv4() }] });

      await DeviceTokenModel.create(data);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [data.userId, data.fcmToken, data.platform, null]
      );
    });

    test('should throw and log on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      await expect(DeviceTokenModel.create(baseData)).rejects.toThrow('DB error');
      expect(logger.error).toHaveBeenCalledWith(
        'Error creating device token',
        expect.objectContaining({ userId: baseData.userId })
      );
    });
  });

  // ─── findByUserId ─────────────────────────────────────────────────────

  describe('findByUserId', () => {
    const userId = uuidv4();

    test('should return active tokens for user', async () => {
      const tokens = [
        { id: uuidv4(), fcm_token: 'token-1', platform: 'ios' },
        { id: uuidv4(), fcm_token: 'token-2', platform: 'android' },
      ];
      mockQuery.mockResolvedValue({ rows: tokens });

      const result = await DeviceTokenModel.findByUserId(userId);

      expect(result).toEqual(tokens);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_active = TRUE'),
        [userId]
      );
    });

    test('should return empty array when no active tokens', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await DeviceTokenModel.findByUserId(userId);

      expect(result).toEqual([]);
    });

    test('should throw and log on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      await expect(DeviceTokenModel.findByUserId(userId)).rejects.toThrow('DB error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── deactivate ───────────────────────────────────────────────────────

  describe('deactivate', () => {
    test('should set is_active = FALSE for token', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await DeviceTokenModel.deactivate('stale-token');

      expect(result).toBe(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_active = FALSE'),
        ['stale-token']
      );
    });

    test('should return 0 if token not found or already inactive', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await DeviceTokenModel.deactivate('unknown-token');

      expect(result).toBe(0);
    });
  });

  // ─── deactivateForUser ────────────────────────────────────────────────

  describe('deactivateForUser', () => {
    test('should deactivate token scoped to user', async () => {
      const userId = uuidv4();
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await DeviceTokenModel.deactivateForUser('my-token', userId);

      expect(result).toBe(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = $2'),
        ['my-token', userId]
      );
    });
  });

  // ─── deleteByUserId ───────────────────────────────────────────────────

  describe('deleteByUserId', () => {
    test('should delete all tokens for user', async () => {
      const userId = uuidv4();
      mockQuery.mockResolvedValue({ rowCount: 3 });

      const result = await DeviceTokenModel.deleteByUserId(userId);

      expect(result).toBe(3);
      expect(logger.info).toHaveBeenCalledWith(
        'Device tokens deleted for user',
        expect.objectContaining({ userId, deleted: 3 })
      );
    });

    test('should return 0 if no tokens existed', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await DeviceTokenModel.deleteByUserId(uuidv4());

      expect(result).toBe(0);
    });
  });
});
