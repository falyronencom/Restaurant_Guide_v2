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
// create() runs on a client of its own: BEGIN, the account under a share
// lock, the INSERT, COMMIT. resetMocks clears every implementation before each
// test, so the client is handed out again by answer() in the test itself.
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockGetClient = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  default: { query: mockQuery },
  getClient: mockGetClient,
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

/** A statement with its whitespace folded, so a predicate reads as written. */
const flat = (sql) => sql.replace(/\s+/g, ' ').trim();

// ============================================================================
// Create
// ============================================================================

describe('create', () => {
  /** The client answers by statement: the account active or not, the INSERT a row. */
  const answer = ({ active = true, insert = { rows: [mockBookingRow] } } = {}) => {
    mockGetClient.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
    mockClientQuery.mockImplementation(async (sql) => {
      if (String(sql).startsWith('SELECT is_active')) return { rows: [{ is_active: active }] };
      if (String(sql).includes('INSERT INTO bookings')) {
        if (insert instanceof Error) throw insert;
        return insert;
      }
      return { rows: [] };
    });
  };
  const statements = () => mockClientQuery.mock.calls.map(([sql]) => flat(String(sql)));

  it('inserts a booking and returns the row — after reading the account under a share lock, in one transaction', async () => {
    answer();

    const result = await Model.create({
      establishmentId: EST_ID,
      userId: USER_ID,
      bookingDate: '2026-04-10',
      bookingTime: '12:00',
      guestCount: 2,
      comment: null,
      contactPhone: '+375291234567',
      confirmationTimeoutHours: 4,
    });

    expect(result).toEqual(mockBookingRow);
    // An account deletion or a block holds the account row FOR UPDATE: the
    // share lock waits for it, and the INSERT comes only after the account
    // is read again (account deletion, Phase 3.5, R6).
    expect(statements()).toEqual([
      'BEGIN',
      'SELECT is_active FROM users WHERE id = $1 FOR SHARE',
      expect.stringContaining('INSERT INTO bookings'),
      'COMMIT',
    ]);
    expect(mockClientQuery.mock.calls[1][1]).toEqual([USER_ID]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
    const [sql, params] = mockClientQuery.mock.calls[2];
    expect(sql).toContain('INSERT INTO bookings');
    expect(sql).toContain('RETURNING *');
    // expires_at comes from the database clock plus the timeout; no JS Date is
    // bound (a zone-less column would store the process wall clock).
    expect(sql).toMatch(/COALESCE\(\$8::timestamptz, NOW\(\)\) \+ make_interval\(hours => \$9::int\)\) AT TIME ZONE 'UTC'/);
    expect(params.slice(7)).toEqual([null, 4]);
    expect(params.some((value) => value instanceof Date)).toBe(false);
  });

  it('the account was switched off meanwhile — nothing inserted, null', async () => {
    answer({ active: false });

    const result = await Model.create({
      establishmentId: EST_ID,
      userId: USER_ID,
      bookingDate: '2026-04-10',
      bookingTime: '12:00',
      guestCount: 2,
      contactPhone: '+375291234567',
      confirmationTimeoutHours: 4,
    });

    expect(result).toBeNull();
    expect(statements()).toEqual(['BEGIN', 'SELECT is_active FROM users WHERE id = $1 FOR SHARE', 'ROLLBACK']);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('propagates DB errors — rolled back, the client released', async () => {
    answer({ insert: new Error('DB error') });

    await expect(Model.create({
      establishmentId: EST_ID,
      userId: USER_ID,
      bookingDate: '2026-04-10',
      bookingTime: '12:00',
      guestCount: 2,
      contactPhone: '+375291234567',
      confirmationTimeoutHours: 4,
    })).rejects.toThrow('DB error');
    expect(statements()).toContain('ROLLBACK');
    expect(statements()).not.toContain('COMMIT');
    expect(mockRelease).toHaveBeenCalledTimes(1);
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

    // First query should be the expiry UPDATE — of pending bookings past their
    // deadline at this establishment: a confirmed one past it stays confirmed,
    // another card's bookings are not this read's business.
    const [firstSql, firstParams] = mockQuery.mock.calls[0];
    expect(firstSql).toContain("status = 'expired'");
    for (const predicate of ["status = 'pending'", 'expires_at < NOW()', 'establishment_id = $1']) {
      expect(flat(firstSql)).toContain(predicate);
    }
    expect(flat(firstSql)).not.toMatch(/\bOR\b/i); // all of them, not any
    expect(firstParams).toEqual([EST_ID]);
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
    // Expiry, not cancellation: only pending bookings, only past the deadline,
    // only this user's.
    const [firstSql, firstParams] = mockQuery.mock.calls[0];
    expect(firstSql).toContain("status = 'expired'");
    for (const predicate of ["status = 'pending'", 'expires_at < NOW()', 'user_id = $1']) {
      expect(flat(firstSql)).toContain(predicate);
    }
    expect(flat(firstSql)).not.toMatch(/\bOR\b/i);
    expect(firstParams).toEqual([USER_ID]);
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

    // The mock hands back a row whatever was asked; «active» is decided by the
    // statement: this user, this card, pending or confirmed — a booking that is
    // over does not hold the one-per-establishment slot.
    const [sql, params] = mockQuery.mock.calls[1];
    for (const predicate of ['user_id = $1', 'establishment_id = $2', "status IN ('pending', 'confirmed')"]) {
      expect(flat(sql)).toContain(predicate);
    }
    expect(flat(sql)).not.toMatch(/\bOR\b/i);
    expect(params).toEqual([USER_ID, EST_ID]);
  });

  it('returns null if no active booking', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    const result = await Model.getActiveForEstablishmentAndUser(USER_ID, EST_ID);
    expect(result).toBeNull();
  });
});
