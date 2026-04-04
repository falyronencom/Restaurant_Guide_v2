/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: bookingSettingsService.js
 *
 * Tests activate/deactivate transactions, settings validation, update logic.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Mocks
// ============================================================================

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockClient = { query: mockClientQuery, release: mockClientRelease };

jest.unstable_mockModule('../../models/bookingSettingsModel.js', () => ({
  getByEstablishmentId: jest.fn(),
  createOrUpdate: jest.fn(),
  updateEnabled: jest.fn(),
}));

jest.unstable_mockModule('../../config/database.js', () => ({
  default: { query: jest.fn() },
  pool: { query: jest.fn() },
  getClient: jest.fn(async () => mockClient),
}));

jest.unstable_mockModule('../../models/partnerAnalyticsModel.js', () => ({
  verifyOwnership: jest.fn(),
}));

jest.unstable_mockModule('../../middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode, code) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
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

const BookingSettingsModel = await import('../../models/bookingSettingsModel.js');
const AnalyticsModel = await import('../../models/partnerAnalyticsModel.js');
const { getClient } = await import('../../config/database.js');

const {
  getSettings,
  activate,
  deactivate,
  updateSettings,
} = await import('../../services/bookingSettingsService.js');

// ============================================================================
// Helpers
// ============================================================================

const EST_ID = uuidv4();
const PARTNER_ID = uuidv4();

const mockSettings = {
  establishment_id: EST_ID,
  is_enabled: true,
  max_guests_per_booking: 10,
  confirmation_timeout_hours: 4,
  max_days_ahead: 7,
  min_hours_before: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  AnalyticsModel.verifyOwnership.mockResolvedValue(true);
  mockClientQuery.mockResolvedValue({ rows: [] });
  // Re-set getClient mock after clearAllMocks
  getClient.mockImplementation(async () => mockClient);
});

// ============================================================================
// getSettings
// ============================================================================

describe('getSettings', () => {
  it('returns settings when found', async () => {
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);

    const result = await getSettings(EST_ID, PARTNER_ID);
    expect(result).toEqual(mockSettings);
  });

  it('returns null when not found', async () => {
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(null);

    const result = await getSettings(EST_ID, PARTNER_ID);
    expect(result).toBeNull();
  });

  it('rejects if not owner', async () => {
    AnalyticsModel.verifyOwnership.mockResolvedValue(false);

    await expect(getSettings(EST_ID, PARTNER_ID))
      .rejects.toThrow('not owned by you');
  });
});

// ============================================================================
// activate
// ============================================================================

describe('activate', () => {
  it('creates settings and enables booking_enabled in transaction', async () => {
    BookingSettingsModel.createOrUpdate.mockResolvedValue(mockSettings);

    const result = await activate(EST_ID, PARTNER_ID, {
      maxGuestsPerBooking: 8,
      confirmationTimeoutHours: 2,
    });

    expect(result).toEqual(mockSettings);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(BookingSettingsModel.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        establishmentId: EST_ID,
        isEnabled: true,
        maxGuestsPerBooking: 8,
        confirmationTimeoutHours: 2,
      }),
      expect.anything(), // client
    );
    // Verify booking_enabled update
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('booking_enabled = TRUE'),
      [EST_ID],
    );
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('rolls back on error', async () => {
    BookingSettingsModel.createOrUpdate.mockRejectedValue(new Error('DB error'));

    await expect(activate(EST_ID, PARTNER_ID))
      .rejects.toThrow('DB error');

    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('validates confirmation_timeout_hours', async () => {
    await expect(activate(EST_ID, PARTNER_ID, { confirmationTimeoutHours: 5 }))
      .rejects.toThrow('confirmation_timeout_hours must be one of');
  });

  it('validates max_days_ahead', async () => {
    await expect(activate(EST_ID, PARTNER_ID, { maxDaysAhead: 10 }))
      .rejects.toThrow('max_days_ahead must be one of');
  });

  it('validates min_hours_before', async () => {
    await expect(activate(EST_ID, PARTNER_ID, { minHoursBefore: 5 }))
      .rejects.toThrow('min_hours_before must be one of');
  });

  it('validates max_guests_per_booking >= 1', async () => {
    await expect(activate(EST_ID, PARTNER_ID, { maxGuestsPerBooking: 0 }))
      .rejects.toThrow('max_guests_per_booking must be >= 1');
  });
});

// ============================================================================
// deactivate
// ============================================================================

describe('deactivate', () => {
  it('disables booking in transaction', async () => {
    BookingSettingsModel.updateEnabled.mockResolvedValue({ ...mockSettings, is_enabled: false });

    const result = await deactivate(EST_ID, PARTNER_ID);

    expect(result.is_enabled).toBe(false);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('booking_enabled = FALSE'),
      [EST_ID],
    );
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('throws NOT_FOUND if no settings', async () => {
    BookingSettingsModel.updateEnabled.mockResolvedValue(null);

    await expect(deactivate(EST_ID, PARTNER_ID))
      .rejects.toThrow('Booking settings not found');
  });
});

// ============================================================================
// updateSettings
// ============================================================================

describe('updateSettings', () => {
  it('updates existing settings', async () => {
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingSettingsModel.createOrUpdate.mockResolvedValue({ ...mockSettings, max_guests_per_booking: 5 });

    const result = await updateSettings(EST_ID, PARTNER_ID, { maxGuestsPerBooking: 5 });

    expect(result.max_guests_per_booking).toBe(5);
    expect(BookingSettingsModel.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxGuestsPerBooking: 5,
        // Other fields preserved from existing
        confirmationTimeoutHours: 4,
        maxDaysAhead: 7,
        minHoursBefore: 2,
      }),
    );
  });

  it('throws NOT_FOUND if no existing settings', async () => {
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(null);

    await expect(updateSettings(EST_ID, PARTNER_ID, {}))
      .rejects.toThrow('Activate booking first');
  });

  it('validates updated fields', async () => {
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);

    await expect(updateSettings(EST_ID, PARTNER_ID, { confirmationTimeoutHours: 99 }))
      .rejects.toThrow('confirmation_timeout_hours must be one of');
  });
});
