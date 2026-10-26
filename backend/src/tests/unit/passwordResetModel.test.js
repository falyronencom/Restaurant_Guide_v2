/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: passwordResetModel.js
 *
 * Mocks pool.query and verifies CRUD methods build the correct SQL
 * with the right parameter shape. Mirrors emailVerificationModel.test.js —
 * the two models share the single-use expiring-token lifecycle.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

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

const Model = await import('../../models/passwordResetModel.js');

const sampleHash = createHash('sha256').update('raw-token').digest('hex');

describe('passwordResetModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findValidByTokenHash', () => {
    test('looks up by hash, excluding used and expired rows', async () => {
      const row = {
        id: uuidv4(),
        user_id: uuidv4(),
        token_hash: sampleHash,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
        created_at: new Date(),
        used_at: null,
      };

      mockQuery.mockResolvedValue({ rows: [row] });

      const result = await Model.findValidByTokenHash(sampleHash);

      expect(result).toEqual(row);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('token_hash = $1');
      expect(sql).toContain('used_at IS NULL');
      expect(sql).toContain('expires_at > CURRENT_TIMESTAMP');
      expect(mockQuery.mock.calls[0][1]).toEqual([sampleHash]);
    });

    test('returns null when nothing matches', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await Model.findValidByTokenHash(sampleHash);

      expect(result).toBeNull();
    });
  });

  describe('markAsUsed', () => {
    test('claims an unused token (rowCount=1 → true)', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await Model.markAsUsed(uuidv4());

      expect(result).toBe(true);
      const sql = mockQuery.mock.calls[0][0];
      // The IS NULL predicate is the atomic single-use guarantee
      expect(sql).toContain('WHERE id = $1 AND used_at IS NULL');
    });

    test('returns false when token was already claimed (lost race)', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await Model.markAsUsed(uuidv4());

      expect(result).toBe(false);
    });
  });
});
