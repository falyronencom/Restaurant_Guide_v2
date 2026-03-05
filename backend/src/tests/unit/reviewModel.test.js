/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: reviewModel.js
 *
 * Tests all database-access methods using mocked pool.
 * Targets uncovered methods: partner responses, aggregation,
 * soft/hard deletion, rating distribution, transactions.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// Mock pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  default: {
    query: mockQuery,
    connect: mockConnect,
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const ReviewModel = await import('../../models/reviewModel.js');

describe('reviewModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
  });

  // ─── createReview ───────────────────────────────────────────────────────

  describe('createReview', () => {
    test('should insert review and return created row', async () => {
      const reviewData = {
        user_id: uuidv4(),
        establishment_id: uuidv4(),
        rating: 5,
        content: 'Great food!',
      };
      const createdRow = { id: uuidv4(), ...reviewData, created_at: new Date(), updated_at: new Date() };
      mockQuery.mockResolvedValue({ rows: [createdRow] });

      const result = await ReviewModel.createReview(reviewData);

      expect(result).toEqual(createdRow);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO reviews'),
        [reviewData.user_id, reviewData.establishment_id, reviewData.rating, reviewData.content]
      );
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('DB connection failed'));

      await expect(ReviewModel.createReview({
        user_id: uuidv4(),
        establishment_id: uuidv4(),
        rating: 3,
        content: 'Test',
      })).rejects.toThrow('DB connection failed');
    });
  });

  // ─── findReviewById ─────────────────────────────────────────────────────

  describe('findReviewById', () => {
    test('should return review when found', async () => {
      const review = { id: uuidv4(), rating: 4, content: 'Nice' };
      mockQuery.mockResolvedValue({ rows: [review] });

      const result = await ReviewModel.findReviewById(review.id);

      expect(result).toEqual(review);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE r.id = $1'),
        [review.id]
      );
    });

    test('should return null when not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await ReviewModel.findReviewById(uuidv4());

      expect(result).toBeNull();
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('connection lost'));

      await expect(ReviewModel.findReviewById('id')).rejects.toThrow('connection lost');
    });
  });

  // ─── findReviewsByEstablishment ─────────────────────────────────────────

  describe('findReviewsByEstablishment', () => {
    const estId = uuidv4();

    test('should return reviews with default options', async () => {
      const reviews = [{ id: 'r1', rating: 5 }, { id: 'r2', rating: 3 }];
      mockQuery.mockResolvedValue({ rows: reviews });

      const result = await ReviewModel.findReviewsByEstablishment(estId);

      expect(result).toEqual(reviews);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY r.created_at DESC'),
        expect.arrayContaining([estId, 10, 0])
      );
    });

    test('should apply highest sort order', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await ReviewModel.findReviewsByEstablishment(estId, { sortBy: 'highest' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('r.rating DESC'),
        expect.any(Array)
      );
    });

    test('should apply lowest sort order', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await ReviewModel.findReviewsByEstablishment(estId, { sortBy: 'lowest' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('r.rating ASC'),
        expect.any(Array)
      );
    });

    test('should include deleted reviews when requested', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await ReviewModel.findReviewsByEstablishment(estId, { includeDeleted: true });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('r.is_deleted = false'),
        expect.any(Array)
      );
    });

    test('should apply date filters', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const dateFrom = '2025-01-01';
      const dateTo = '2025-12-31';

      await ReviewModel.findReviewsByEstablishment(estId, { dateFrom, dateTo });

      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain('r.created_at >=');
      expect(callArgs[0]).toContain('r.created_at <=');
      expect(callArgs[1]).toContain(dateFrom);
      expect(callArgs[1]).toContain(dateTo);
    });

    test('should respect custom limit and offset', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await ReviewModel.findReviewsByEstablishment(estId, { limit: 5, offset: 10 });

      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[1]).toContain(5);
      expect(callArgs[1]).toContain(10);
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('query timeout'));

      await expect(
        ReviewModel.findReviewsByEstablishment(estId)
      ).rejects.toThrow('query timeout');
    });
  });

  // ─── countReviewsByEstablishment ────────────────────────────────────────

  describe('countReviewsByEstablishment', () => {
    const estId = uuidv4();

    test('should return integer count', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '42' }] });

      const result = await ReviewModel.countReviewsByEstablishment(estId);

      expect(result).toBe(42);
    });

    test('should support backwards-compat boolean argument', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '5' }] });

      const result = await ReviewModel.countReviewsByEstablishment(estId, true);

      expect(result).toBe(5);
      // includeDeleted=true means no is_deleted filter
      expect(mockQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('is_deleted = false'),
        expect.any(Array)
      );
    });

    test('should apply date filters', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '3' }] });

      await ReviewModel.countReviewsByEstablishment(estId, {
        dateFrom: '2025-06-01',
        dateTo: '2025-06-30',
      });

      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain('created_at >=');
      expect(callArgs[0]).toContain('created_at <=');
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('count error'));

      await expect(ReviewModel.countReviewsByEstablishment(estId)).rejects.toThrow('count error');
    });
  });

  // ─── findReviewsByUser ──────────────────────────────────────────────────

  describe('findReviewsByUser', () => {
    test('should return user reviews with establishment info', async () => {
      const reviews = [{ id: 'r1', establishment_name: 'Test Place' }];
      mockQuery.mockResolvedValue({ rows: reviews });

      const result = await ReviewModel.findReviewsByUser(uuidv4());

      expect(result).toEqual(reviews);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('JOIN establishments'),
        expect.any(Array)
      );
    });

    test('should exclude deleted by default', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await ReviewModel.findReviewsByUser(uuidv4());

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('r.is_deleted = false'),
        expect.any(Array)
      );
    });

    test('should include deleted when requested', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await ReviewModel.findReviewsByUser(uuidv4(), { includeDeleted: true });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('r.is_deleted = false'),
        expect.any(Array)
      );
    });
  });

  // ─── countReviewsByUser ─────────────────────────────────────────────────

  describe('countReviewsByUser', () => {
    test('should return integer count', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '7' }] });

      const result = await ReviewModel.countReviewsByUser(uuidv4());

      expect(result).toBe(7);
    });

    test('should exclude deleted by default', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '0' }] });

      await ReviewModel.countReviewsByUser(uuidv4());

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = false'),
        expect.any(Array)
      );
    });
  });

  // ─── findExistingReview ─────────────────────────────────────────────────

  describe('findExistingReview', () => {
    test('should return existing review', async () => {
      const review = { id: 'r1', rating: 5 };
      mockQuery.mockResolvedValue({ rows: [review] });

      const result = await ReviewModel.findExistingReview(uuidv4(), uuidv4());

      expect(result).toEqual(review);
    });

    test('should return null when no existing review', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await ReviewModel.findExistingReview(uuidv4(), uuidv4());

      expect(result).toBeNull();
    });
  });

  // ─── updateReview ───────────────────────────────────────────────────────

  describe('updateReview', () => {
    test('should update rating only', async () => {
      const updated = { id: 'r1', rating: 3, is_edited: true };
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await ReviewModel.updateReview('r1', { rating: 3 });

      expect(result).toEqual(updated);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('rating = $1');
      expect(sql).toContain('is_edited = true');
    });

    test('should update content only', async () => {
      const updated = { id: 'r1', content: 'New', is_edited: true };
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await ReviewModel.updateReview('r1', { content: 'New' });

      expect(result).toEqual(updated);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('content = $1');
      expect(sql).toContain('text = $1'); // legacy column sync
    });

    test('should update both rating and content', async () => {
      const updated = { id: 'r1', rating: 2, content: 'Changed' };
      mockQuery.mockResolvedValue({ rows: [updated] });

      await ReviewModel.updateReview('r1', { rating: 2, content: 'Changed' });

      const values = mockQuery.mock.calls[0][1];
      expect(values).toContain(2);
      expect(values).toContain('Changed');
    });

    test('should throw when review not found or already deleted', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        ReviewModel.updateReview('nonexistent', { rating: 1 })
      ).rejects.toThrow('Review not found or already deleted');
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('constraint violation'));

      await expect(
        ReviewModel.updateReview('r1', { rating: 3 })
      ).rejects.toThrow('constraint violation');
    });
  });

  // ─── softDeleteReview ───────────────────────────────────────────────────

  describe('softDeleteReview', () => {
    test('should return true when review soft-deleted', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'r1' }] });

      const result = await ReviewModel.softDeleteReview('r1');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = true'),
        ['r1']
      );
    });

    test('should return false when review not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await ReviewModel.softDeleteReview('nonexistent');

      expect(result).toBe(false);
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('soft delete error'));

      await expect(ReviewModel.softDeleteReview('r1')).rejects.toThrow('soft delete error');
    });
  });

  // ─── hardDeleteReview ───────────────────────────────────────────────────

  describe('hardDeleteReview', () => {
    test('should return true when review hard-deleted', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'r1' }] });

      const result = await ReviewModel.hardDeleteReview('r1');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM reviews'),
        ['r1']
      );
    });

    test('should return false when review not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await ReviewModel.hardDeleteReview('nonexistent');

      expect(result).toBe(false);
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('hard delete error'));

      await expect(ReviewModel.hardDeleteReview('r1')).rejects.toThrow('hard delete error');
    });
  });

  // ─── updateEstablishmentAggregates ──────────────────────────────────────

  describe('updateEstablishmentAggregates', () => {
    test('should return updated aggregates', async () => {
      const aggregates = { average_rating: '4.50', review_count: 10 };
      mockQuery.mockResolvedValue({ rows: [aggregates] });

      const result = await ReviewModel.updateEstablishmentAggregates(uuidv4());

      expect(result).toEqual(aggregates);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE establishments'),
        expect.any(Array)
      );
    });

    test('should throw when establishment not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        ReviewModel.updateEstablishmentAggregates(uuidv4())
      ).rejects.toThrow('Establishment not found');
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('aggregate error'));

      await expect(
        ReviewModel.updateEstablishmentAggregates(uuidv4())
      ).rejects.toThrow('aggregate error');
    });
  });

  // ─── getRatingDistribution ──────────────────────────────────────────────

  describe('getRatingDistribution', () => {
    test('should return full 1-5 distribution', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { rating: 1, count: 2 },
          { rating: 3, count: 5 },
          { rating: 5, count: 8 },
        ],
      });

      const result = await ReviewModel.getRatingDistribution(uuidv4());

      expect(result).toEqual({
        1: 2, 2: 0, 3: 5, 4: 0, 5: 8,
      });
    });

    test('should return all zeros when no reviews', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await ReviewModel.getRatingDistribution(uuidv4());

      expect(result).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('distribution error'));

      await expect(ReviewModel.getRatingDistribution(uuidv4())).rejects.toThrow('distribution error');
    });
  });

  // ─── getReviewWithEstablishment ─────────────────────────────────────────

  describe('getReviewWithEstablishment', () => {
    test('should return review with partner_id', async () => {
      const row = {
        id: 'r1',
        establishment_id: 'e1',
        user_id: 'u1',
        partner_response: null,
        partner_id: 'p1',
      };
      mockQuery.mockResolvedValue({ rows: [row] });

      const result = await ReviewModel.getReviewWithEstablishment('r1');

      expect(result).toEqual(row);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('JOIN establishments'),
        ['r1']
      );
    });

    test('should return null when not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await ReviewModel.getReviewWithEstablishment('missing');

      expect(result).toBeNull();
    });
  });

  // ─── addPartnerResponse ─────────────────────────────────────────────────

  describe('addPartnerResponse', () => {
    test('should set partner response fields', async () => {
      const responseRow = {
        id: 'r1',
        partner_response: 'Thank you!',
        partner_response_at: new Date(),
        partner_responder_id: 'p1',
      };
      mockQuery.mockResolvedValue({ rows: [responseRow] });

      const result = await ReviewModel.addPartnerResponse('r1', 'p1', 'Thank you!');

      expect(result).toEqual(responseRow);
      const values = mockQuery.mock.calls[0][1];
      expect(values).toEqual(['Thank you!', 'p1', 'r1']);
    });

    test('should throw when review not found or deleted', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        ReviewModel.addPartnerResponse('missing', 'p1', 'Reply')
      ).rejects.toThrow('Review not found or already deleted');
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('response error'));

      await expect(
        ReviewModel.addPartnerResponse('r1', 'p1', 'Reply')
      ).rejects.toThrow('response error');
    });
  });

  // ─── updatePartnerResponse (alias) ──────────────────────────────────────

  describe('updatePartnerResponse', () => {
    test('should be an alias for addPartnerResponse', () => {
      expect(ReviewModel.updatePartnerResponse).toBe(ReviewModel.addPartnerResponse);
    });
  });

  // ─── deletePartnerResponse ──────────────────────────────────────────────

  describe('deletePartnerResponse', () => {
    test('should null out partner response fields', async () => {
      const clearedRow = {
        id: 'r1',
        partner_response: null,
        partner_response_at: null,
        partner_responder_id: null,
      };
      mockQuery.mockResolvedValue({ rows: [clearedRow] });

      const result = await ReviewModel.deletePartnerResponse('r1');

      expect(result).toEqual(clearedRow);
      expect(result.partner_response).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('partner_response = NULL'),
        ['r1']
      );
    });

    test('should throw when review not found or deleted', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        ReviewModel.deletePartnerResponse('missing')
      ).rejects.toThrow('Review not found or already deleted');
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('delete response error'));

      await expect(
        ReviewModel.deletePartnerResponse('r1')
      ).rejects.toThrow('delete response error');
    });
  });

  // ─── executeInTransaction ───────────────────────────────────────────────

  describe('executeInTransaction', () => {
    test('should BEGIN, execute callback, COMMIT', async () => {
      mockClientQuery.mockResolvedValue(undefined);

      const callbackResult = { success: true };
      const callback = jest.fn().mockResolvedValue(callbackResult);

      const result = await ReviewModel.executeInTransaction(callback);

      expect(result).toEqual(callbackResult);
      expect(mockConnect).toHaveBeenCalled();
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(callback).toHaveBeenCalled();
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    test('should ROLLBACK on callback error and release client', async () => {
      mockClientQuery.mockResolvedValue(undefined);

      const callback = jest.fn().mockRejectedValue(new Error('business logic failed'));

      await expect(
        ReviewModel.executeInTransaction(callback)
      ).rejects.toThrow('business logic failed');

      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    test('should always release client even on ROLLBACK error', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const callback = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(
        ReviewModel.executeInTransaction(callback)
      ).rejects.toThrow('fail');

      expect(mockClientRelease).toHaveBeenCalled();
    });
  });

  // ─── establishmentExists ────────────────────────────────────────────────

  describe('establishmentExists', () => {
    test('should return true when establishment exists', async () => {
      mockQuery.mockResolvedValue({ rows: [{ exists: true }] });

      const result = await ReviewModel.establishmentExists(uuidv4());

      expect(result).toBe(true);
    });

    test('should return false when establishment does not exist', async () => {
      mockQuery.mockResolvedValue({ rows: [{ exists: false }] });

      const result = await ReviewModel.establishmentExists(uuidv4());

      expect(result).toBe(false);
    });

    test('should exclude archived establishments', async () => {
      mockQuery.mockResolvedValue({ rows: [{ exists: false }] });

      await ReviewModel.establishmentExists(uuidv4());

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status != 'archived'"),
        expect.any(Array)
      );
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('exists error'));

      await expect(ReviewModel.establishmentExists(uuidv4())).rejects.toThrow('exists error');
    });
  });

  // ─── getUserById ────────────────────────────────────────────────────────

  describe('getUserById', () => {
    test('should return user when found', async () => {
      const user = { id: 'u1', email: 'test@test.com', name: 'Test', role: 'user', is_active: true };
      mockQuery.mockResolvedValue({ rows: [user] });

      const result = await ReviewModel.getUserById('u1');

      expect(result).toEqual(user);
    });

    test('should return null when user not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await ReviewModel.getUserById('missing');

      expect(result).toBeNull();
    });

    test('should throw on database error', async () => {
      mockQuery.mockRejectedValue(new Error('user error'));

      await expect(ReviewModel.getUserById('u1')).rejects.toThrow('user error');
    });
  });
});
