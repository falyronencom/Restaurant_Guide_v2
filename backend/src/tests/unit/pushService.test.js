/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: pushService.js
 *
 * Tests push delivery logic with mocked Firebase, device tokens, and preferences.
 * Covers: sendPush (active tokens, no tokens, disabled preference, stale token cleanup),
 *         category mapping correctness, Firebase unavailable graceful skip.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
const mockFindByUserId = jest.fn();
const mockDeactivate = jest.fn();
const mockGetByUserId = jest.fn();
const mockSendEachForMulticast = jest.fn();
const mockIsAvailable = jest.fn();
const mockGetMessaging = jest.fn();

jest.unstable_mockModule('../../models/deviceTokenModel.js', () => ({
  findByUserId: mockFindByUserId,
  deactivate: mockDeactivate,
}));

jest.unstable_mockModule('../../models/notificationPreferencesModel.js', () => ({
  getByUserId: mockGetByUserId,
}));

jest.unstable_mockModule('../../config/firebaseAdmin.js', () => ({
  isAvailable: mockIsAvailable,
  getMessaging: mockGetMessaging,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const {
  sendPush,
  TYPE_CATEGORY_MAP,
  CATEGORY_PREF_FIELD,
  isPushEnabledForType,
} = await import('../../services/pushService.js');
const logger = (await import('../../utils/logger.js')).default;

describe('pushService', () => {
  const userId = uuidv4();
  const basePayload = {
    title: 'Новая бронь',
    message: 'Новая бронь на «Test»',
    data: { type: 'booking_received', establishmentId: uuidv4() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAvailable.mockReturnValue(true);
    mockGetMessaging.mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    });
    mockGetByUserId.mockResolvedValue({
      booking_push_enabled: true,
      reviews_push_enabled: true,
      promotions_push_enabled: true,
    });
  });

  // ─── sendPush — happy path ────────────────────────────────────────────

  describe('sendPush — delivery', () => {
    test('should send push to all active tokens', async () => {
      const tokens = [
        { fcm_token: 'token-1', platform: 'ios' },
        { fcm_token: 'token-2', platform: 'android' },
      ];
      mockFindByUserId.mockResolvedValue(tokens);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 2,
        failureCount: 0,
        responses: [{ success: true }, { success: true }],
      });

      await sendPush(userId, basePayload);

      expect(mockSendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          notification: { title: basePayload.title, body: basePayload.message },
          tokens: ['token-1', 'token-2'],
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Push sent',
        expect.objectContaining({ successCount: 2, failureCount: 0 })
      );
    });

    test('should stringify data values for FCM', async () => {
      mockFindByUserId.mockResolvedValue([{ fcm_token: 'tok' }]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });

      await sendPush(userId, {
        title: 'Test',
        message: 'Body',
        data: { type: 'booking_received', count: 42 },
      });

      const call = mockSendEachForMulticast.mock.calls[0][0];
      expect(call.data.count).toBe('42');
      expect(call.data.type).toBe('booking_received');
    });
  });

  // ─── sendPush — skip conditions ───────────────────────────────────────

  describe('sendPush — skip conditions', () => {
    test('should skip silently when Firebase not configured', async () => {
      mockIsAvailable.mockReturnValue(false);

      await sendPush(userId, basePayload);

      expect(mockFindByUserId).not.toHaveBeenCalled();
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Push skipped: Firebase not configured',
        expect.any(Object)
      );
    });

    test('should skip silently when no active device tokens', async () => {
      mockFindByUserId.mockResolvedValue([]);

      await sendPush(userId, basePayload);

      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Push skipped: no active device tokens',
        expect.any(Object)
      );
    });

    test('should skip when user disabled booking push', async () => {
      mockGetByUserId.mockResolvedValue({
        booking_push_enabled: false,
        reviews_push_enabled: true,
        promotions_push_enabled: true,
      });

      await sendPush(userId, basePayload);

      expect(mockFindByUserId).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Push skipped: disabled by user preferences',
        expect.any(Object)
      );
    });

    test('should skip for in-app only types (review_hidden)', async () => {
      const payload = {
        ...basePayload,
        data: { type: 'review_hidden' },
      };

      await sendPush(userId, payload);

      expect(mockFindByUserId).not.toHaveBeenCalled();
    });

    test('should skip for in-app only types (establishment_claimed)', async () => {
      const payload = {
        ...basePayload,
        data: { type: 'establishment_claimed' },
      };

      await sendPush(userId, payload);

      expect(mockFindByUserId).not.toHaveBeenCalled();
    });
  });

  // ─── sendPush — stale token handling ──────────────────────────────────

  describe('sendPush — stale tokens', () => {
    test('should deactivate stale tokens reported by FCM', async () => {
      mockFindByUserId.mockResolvedValue([
        { fcm_token: 'valid-token' },
        { fcm_token: 'stale-token' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true },
          {
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          },
        ],
      });
      mockDeactivate.mockResolvedValue(1);

      await sendPush(userId, basePayload);

      expect(mockDeactivate).toHaveBeenCalledWith('stale-token');
    });

    test('should deactivate invalid tokens', async () => {
      mockFindByUserId.mockResolvedValue([{ fcm_token: 'bad-token' }]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [
          {
            success: false,
            error: { code: 'messaging/invalid-registration-token' },
          },
        ],
      });
      mockDeactivate.mockResolvedValue(1);

      await sendPush(userId, basePayload);

      expect(mockDeactivate).toHaveBeenCalledWith('bad-token');
    });
  });

  // ─── sendPush — non-blocking error handling ───────────────────────────

  describe('sendPush — error handling', () => {
    test('should NOT throw on FCM send error — log and swallow', async () => {
      mockFindByUserId.mockResolvedValue([{ fcm_token: 'tok' }]);
      mockSendEachForMulticast.mockRejectedValue(new Error('FCM unavailable'));

      // Should NOT throw
      await sendPush(userId, basePayload);

      expect(logger.error).toHaveBeenCalledWith(
        'Push notification failed',
        expect.objectContaining({ error: 'FCM unavailable' })
      );
    });

    test('should NOT throw on preferences DB error', async () => {
      mockGetByUserId.mockRejectedValue(new Error('DB connection lost'));

      await sendPush(userId, basePayload);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── category mapping ─────────────────────────────────────────────────

  describe('TYPE_CATEGORY_MAP', () => {
    test('booking types map to booking category', () => {
      const bookingTypes = [
        'booking_received', 'booking_confirmed', 'booking_declined',
        'booking_expired', 'booking_cancelled',
      ];
      bookingTypes.forEach((type) => {
        expect(TYPE_CATEGORY_MAP[type]).toBe('booking');
      });
    });

    test('review types map to reviews category', () => {
      const reviewTypes = [
        'new_review', 'partner_response',
        'establishment_approved', 'establishment_rejected',
        'establishment_suspended', 'establishment_unsuspended',
      ];
      reviewTypes.forEach((type) => {
        expect(TYPE_CATEGORY_MAP[type]).toBe('reviews');
      });
    });

    test('promotion types map to promotions category', () => {
      expect(TYPE_CATEGORY_MAP['promotion_new']).toBe('promotions');
    });

    test('in-app only types map to null', () => {
      expect(TYPE_CATEGORY_MAP['establishment_claimed']).toBeNull();
      expect(TYPE_CATEGORY_MAP['review_hidden']).toBeNull();
      expect(TYPE_CATEGORY_MAP['review_deleted']).toBeNull();
    });
  });

  // ─── isPushEnabledForType ─────────────────────────────────────────────

  describe('isPushEnabledForType', () => {
    test('should return true when category enabled', () => {
      const prefs = { booking_push_enabled: true };
      expect(isPushEnabledForType('booking_received', prefs)).toBe(true);
    });

    test('should return false when category disabled', () => {
      const prefs = { booking_push_enabled: false };
      expect(isPushEnabledForType('booking_received', prefs)).toBe(false);
    });

    test('should return false for null-mapped types', () => {
      const prefs = { booking_push_enabled: true, reviews_push_enabled: true };
      expect(isPushEnabledForType('review_hidden', prefs)).toBe(false);
    });

    test('should default to true for missing preference field', () => {
      expect(isPushEnabledForType('booking_received', {})).toBe(true);
    });
  });
});
