/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: emailVerificationModel.js
 *
 * Mocks pool.query and verifies CRUD methods build the correct SQL
 * with the right parameter shape.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

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

const Model = await import('../../models/emailVerificationModel.js');

describe('emailVerificationModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCode', () => {
    test('inserts a row and returns it', async () => {
      const userId = uuidv4();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const inserted = {
        id: uuidv4(),
        user_id: userId,
        code: '123456',
        expires_at: expiresAt,
        created_at: new Date(),
        used_at: null,
        attempts: 0,
      };

      mockQuery.mockResolvedValue({ rows: [inserted] });

      const result = await Model.createCode(userId, '123456', expiresAt);

      expect(result).toEqual(inserted);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO email_verification_codes'),
        [userId, '123456', expiresAt],
      );
    });
  });

  describe('findActiveCodeForUser', () => {
    test('returns latest non-used non-expired code', async () => {
      const userId = uuidv4();
      const row = {
        id: uuidv4(),
        user_id: userId,
        code: '654321',
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
        created_at: new Date(),
        used_at: null,
        attempts: 1,
      };

      mockQuery.mockResolvedValue({ rows: [row] });

      const result = await Model.findActiveCodeForUser(userId);

      expect(result).toEqual(row);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('used_at IS NULL');
      expect(sql).toContain('expires_at > CURRENT_TIMESTAMP');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT 1');
    });

    test('returns null when no active codes exist', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await Model.findActiveCodeForUser(uuidv4());

      expect(result).toBeNull();
    });
  });

  describe('countRecentSends', () => {
    test('returns count of codes within interval', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: 3 }] });

      const result = await Model.countRecentSends(uuidv4(), 60);

      expect(result).toBe(3);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain("created_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval");
      const args = mockQuery.mock.calls[0][1];
      expect(args[1]).toBe('60');
    });
  });

  describe('invalidateActiveCodesForUser', () => {
    test('marks all active codes as used', async () => {
      mockQuery.mockResolvedValue({ rowCount: 2 });

      const result = await Model.invalidateActiveCodesForUser(uuidv4());

      expect(result).toBe(2);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('UPDATE email_verification_codes');
      expect(sql).toContain('SET used_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('used_at IS NULL');
    });
  });

  // What the statement does under concurrent requests is proven against the
  // database (integration/auth-email-verification.test.js); here — its shape.
  describe('spendCodeAttempt', () => {
    test('one statement: the guess, the account and the limit of 5 go to the UPDATE; its row comes back', async () => {
      const row = { id: uuidv4(), attempts: 2, matched: false };
      mockQuery.mockResolvedValue({ rows: [row] });
      const userId = uuidv4();

      const result = await Model.spendCodeAttempt(userId, '123456');

      expect(result).toEqual(row);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(params).toEqual([userId, '123456', 5]);
      expect(sql).toContain('UPDATE email_verification_codes');
      expect(sql).toContain('SET attempts = attempts + 1');
      expect(sql).toContain('RETURNING id, attempts, code = $2 AS matched');
    });

    test('null when the UPDATE returns no row', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      expect(await Model.spendCodeAttempt(uuidv4(), '123456')).toBeNull();
    });
  });

  describe('markAsUsed', () => {
    test('returns true when row updated', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await Model.markAsUsed(uuidv4());

      expect(result).toBe(true);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('SET used_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('used_at IS NULL');
    });

    test('returns false when row already used or missing', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await Model.markAsUsed(uuidv4());

      expect(result).toBe(false);
    });
  });
});
