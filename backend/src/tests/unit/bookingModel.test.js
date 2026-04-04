/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: bookingModel.js
 *
 * Tests SQL query construction with mocked pool.
 * Covers: create, updateStatus, getById, getByEstablishmentId, getByUserId,
 * getActiveCountForUser, getActiveForEstablishmentAndUser, lazy expiry.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Mocks
// ============================================================================

const mockQuery = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  default: { query: mockQuery },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const Model = await import('../../models/bookingModel.js');

// ============================================================================
// Helpers
// ============================================================================

const EST_ID = uuidv4();
const USER_ID = uuidv4();
const BOOKING_ID = uuidv4();

const mockBookingRow = {
  id: BOOKING_ID,
  establishment_id: EST_ID,
  user_id: USER_ID,
  booking_date: '2026-04-10',
  booking_time: '12:00',
  guest_count: 2,
  status: 'pending',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// Create
// ============================================================================

describe('create', () => {
  it('inserts a booking and returns the row', async () => {
    mockQuery.mockResolvedValue({ rows: [mockBookingRow] });

    const result = await Model.create({
      establishmentId: EST_ID,
      userId: USER_ID,
      bookingDate: '2026-04-10',
      bookingTime: '12:00',
      guestCount: 2,
      comment: null,
      contactPhone: '+375291234567',
      expiresAt: new Date(),
    });

    expect(result).toEqual(mockBookingRow);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO bookings');
    expect(sql).toContain('RETURNING *');
  });

  it('propagates DB errors', async () => {
    mockQuery.mockRejectedValue(new Error('DB error'));

    await expect(Model.create({
      establishmentId: EST_ID,
      userId: USER_ID,
      bookingDate: '2026-04-10',
      bookingTime: '12:00',
      guestCount: 2,
      contactPhone: '+375291234567',
      expiresAt: new Date(),
    })).rejects.toThrow('DB error');
  });
});

// ============================================================================
// updateStatus
// ============================================================================

describe('updateStatus', () => {
  it('updates status and returns row', async () => {
    const updated = { ...mockBookingRow, status: 'confirmed' };
    mockQuery.mockResolvedValue({ rows: [updated] });

    const result = await Model.updateStatus(BOOKING_ID, {
      status: 'confirmed',
      confirmedAt: new Date(),
    });

    expect(result.status).toBe('confirmed');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('status = $2');
    expect(sql).toContain('confirmed_at');
  });

  it('includes decline_reason when provided', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...mockBookingRow, status: 'declined' }] });

    await Model.updateStatus(BOOKING_ID, {
      status: 'declined',
      declineReason: 'Fully booked',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('decline_reason');
    expect(params).toContain('Fully booked');
  });

  it('returns null when booking not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await Model.updateStatus('nonexistent', { status: 'confirmed' });
    expect(result).toBeNull();
  });
});

// ============================================================================
// getById
// ============================================================================

describe('getById', () => {
  it('returns booking with joined data', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...mockBookingRow, establishment_name: 'Test', user_name: 'User' }] });

    const result = await Model.getById(BOOKING_ID);
    expect(result.establishment_name).toBe('Test');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('JOIN establishments');
    expect(sql).toContain('JOIN users');
  });

  it('returns null when not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await Model.getById('nonexistent');
    expect(result).toBeNull();
  });
});

// ============================================================================
// getByEstablishmentId (with lazy expiry)
// ============================================================================

describe('getByEstablishmentId', () => {
  it('runs lazy expiry before reading', async () => {
    // First call: lazy expiry UPDATE
    // Second call: COUNT query
    // Third call: data SELECT query
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // expiry
      .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // count
      .mockResolvedValueOnce({ rows: [mockBookingRow] }); // data

    const result = await Model.getByEstablishmentId(EST_ID);

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);

    // First query should be the expiry UPDATE
    const [firstSql] = mockQuery.mock.calls[0];
    expect(firstSql).toContain("status = 'expired'");
    expect(firstSql).toContain('expires_at < NOW()');
  });

  it('applies status filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await Model.getByEstablishmentId(EST_ID, { status: 'confirmed' });

    // Data query should contain status filter
    const dataCall = mockQuery.mock.calls[2];
    expect(dataCall[0]).toContain('b.status =');
    expect(dataCall[1]).toContain('confirmed');
  });
});

// ============================================================================
// getByUserId (with lazy expiry)
// ============================================================================

describe('getByUserId', () => {
  it('runs lazy expiry for user before reading', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // user expiry
      .mockResolvedValueOnce({ rows: [] }); // data

    const result = await Model.getByUserId(USER_ID);

    expect(result).toEqual([]);
    const [firstSql] = mockQuery.mock.calls[0];
    expect(firstSql).toContain("status = 'expired'");
    expect(firstSql).toContain('user_id = $1');
  });
});

// ============================================================================
// getActiveCountForUser
// ============================================================================

describe('getActiveCountForUser', () => {
  it('returns count of active bookings', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // expiry
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const result = await Model.getActiveCountForUser(USER_ID);
    expect(result).toBe(1);

    const [countSql] = mockQuery.mock.calls[1];
    expect(countSql).toContain("status IN ('pending', 'confirmed')");
  });
});

// ============================================================================
// getActiveForEstablishmentAndUser
// ============================================================================

describe('getActiveForEstablishmentAndUser', () => {
  it('returns active booking if exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // expiry
      .mockResolvedValueOnce({ rows: [mockBookingRow] });

    const result = await Model.getActiveForEstablishmentAndUser(USER_ID, EST_ID);
    expect(result).toEqual(mockBookingRow);
  });

  it('returns null if no active booking', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    const result = await Model.getActiveForEstablishmentAndUser(USER_ID, EST_ID);
    expect(result).toBeNull();
  });
});
