/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: reviewService.js
 *
 * Tests review business logic in isolation using mocked dependencies.
 * These tests verify:
 * - Review creation with validation
 * - Rate limiting enforcement
 * - Duplicate review detection
 * - Aggregate statistics updates
 * - Ownership verification
 */

import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../../models/reviewModel.js', () => ({
  getUserById: jest.fn(),
  establishmentExists: jest.fn(),
  getEstablishmentStatus: jest.fn(),
  findExistingReview: jest.fn(),
  createReview: jest.fn(),
  updateEstablishmentAggregates: jest.fn(),
  findReviewById: jest.fn(),
  updateReview: jest.fn(),
  softDeleteReview: jest.fn(),
  findReviewsByEstablishment: jest.fn(),
  countReviewsByEstablishment: jest.fn(),
  findReviewsByUser: jest.fn(),
  countReviewsByUser: jest.fn(),
  // The service runs insert + aggregates inside this; the mock hands the
  // callback a marker client so the tests can see both calls share it.
  executeInTransaction: jest.fn(),
}));

jest.unstable_mockModule('../../config/redis.js', () => ({
  incrementWithExpiry: jest.fn(),
  decrement: jest.fn(),
  getCounter: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
const ReviewModel = await import('../../models/reviewModel.js');
const { incrementWithExpiry, decrement, getCounter } = await import('../../config/redis.js');
const TX_CLIENT = { query: jest.fn(), marker: 'tx-client' };
const logger = (await import('../../utils/logger.js')).default;

const {
  createReview,
  updateReview,
  deleteReview,
  getEstablishmentReviews,
  getReviewById,
  getUserReviews,
  getEstablishmentAggregates,
  getUserReviewQuota,
} = await import('../../services/reviewService.js');

import { createMockUser, createMockReview } from '../mocks/helpers.js';

describe('reviewService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createReview', () => {
    const validReviewData = {
      user_id: 'user-123',
      establishment_id: 'estab-123',
      rating: 5,
      content: 'Great place! Excellent food and service.',
    };

    const mockUser = createMockUser({ id: 'user-123', is_active: true });
    const mockReview = createMockReview(validReviewData);

    beforeEach(() => {
      // Setup default mocks for successful creation
      ReviewModel.getUserById.mockResolvedValue(mockUser);
      ReviewModel.getEstablishmentStatus.mockResolvedValue('active');
      ReviewModel.findExistingReview.mockResolvedValue(null);
      ReviewModel.createReview.mockResolvedValue(mockReview);
      ReviewModel.updateEstablishmentAggregates.mockResolvedValue(undefined);
      ReviewModel.findReviewById.mockResolvedValue(mockReview);
      ReviewModel.executeInTransaction.mockImplementation((callback) => callback(TX_CLIENT));
      // The account read again inside the transaction (FOR SHARE): active.
      TX_CLIENT.query.mockResolvedValue({ rows: [{ is_active: true }] });
      // The quota slot is reserved first: the counter answers the new value.
      incrementWithExpiry.mockResolvedValue(1);
      decrement.mockResolvedValue(0);
    });

    test('should create review with valid data', async () => {
      const result = await createReview(validReviewData);

      expect(result).toEqual(mockReview);

      // Verify user validation
      expect(ReviewModel.getUserById).toHaveBeenCalledWith('user-123');

      // Verify establishment validation
      expect(ReviewModel.getEstablishmentStatus).toHaveBeenCalledWith('estab-123');

      // Verify the quota slot is reserved before anything is written
      // The window ends at Minsk midnight — a number of seconds within the day.
      expect(incrementWithExpiry).toHaveBeenCalledWith('reviews:ratelimit:user-123', expect.any(Number));
      const [, ttl] = incrementWithExpiry.mock.calls[0];
      expect(ttl).toBeGreaterThanOrEqual(1);
      expect(ttl).toBeLessThanOrEqual(86400);
      expect(incrementWithExpiry.mock.invocationCallOrder[0])
        .toBeLessThan(ReviewModel.createReview.mock.invocationCallOrder[0]);

      // Verify duplicate check
      expect(ReviewModel.findExistingReview).toHaveBeenCalledWith('user-123', 'estab-123');

      // Verify review creation and aggregates share one transaction client
      expect(ReviewModel.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(ReviewModel.createReview).toHaveBeenCalledWith(validReviewData, TX_CLIENT);
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith('estab-123', TX_CLIENT);

      // The slot stays taken
      expect(decrement).not.toHaveBeenCalled();

      expect(logger.info).toHaveBeenCalledWith(
        'Review created successfully',
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    test('should throw error if user not found', async () => {
      ReviewModel.getUserById.mockResolvedValue(null);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });

      // Should not proceed to create review
      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should throw error if user is inactive', async () => {
      ReviewModel.getUserById.mockResolvedValue({
        ...mockUser,
        is_active: false,
      });

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 403,
        code: 'USER_INACTIVE',
      });

      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should throw error if establishment not found', async () => {
      ReviewModel.getEstablishmentStatus.mockResolvedValue(null);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });

      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('refuses a card the catalogue does not show, before the quota slot is reserved', async () => {
      ReviewModel.getEstablishmentStatus.mockResolvedValue('suspended');

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 400,
        code: 'ESTABLISHMENT_NOT_ACTIVE',
        message: 'Это заведение сейчас не показывается в каталоге — оставить отзыв нельзя',
      });

      expect(incrementWithExpiry).not.toHaveBeenCalled();
      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('should enforce rate limit of 10 reviews per day', async () => {
      incrementWithExpiry.mockResolvedValue(11); // The eleventh reservation of the day

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Rate limit exceeded for review creation',
        expect.objectContaining({ currentCount: 10, limit: 10 })
      );

      // The refused reservation is given back
      expect(decrement).toHaveBeenCalledWith('reviews:ratelimit:user-123');
      expect(ReviewModel.createReview).not.toHaveBeenCalled();
    });

    test('the daily limit refusal is Russian and names when the quota renews', async () => {
      incrementWithExpiry.mockResolvedValue(11);

      const refusal = await createReview(validReviewData).catch((e) => e);

      expect(refusal.message).toBe(
        'Лимит отзывов на сегодня исчерпан: не больше 10 в день. Новый отзыв можно написать завтра.',
      );
      // The term is the counter's own: the seconds it was given to live,
      // until Minsk midnight — the header and the body say the same.
      const ttl = incrementWithExpiry.mock.calls[0][1];
      expect(refusal.retryAfter).toBe(ttl);
      expect(refusal.details).toEqual({
        reviews_limit: 10,
        retry_after: ttl,
        reset_at: expect.any(String),
      });
    });

    test('should allow review when under rate limit', async () => {
      incrementWithExpiry.mockResolvedValue(10); // The tenth reservation — the last allowed

      await expect(createReview(validReviewData)).resolves.toBeDefined();

      expect(ReviewModel.createReview).toHaveBeenCalled();
      expect(decrement).not.toHaveBeenCalled();
    });

    test('should detect duplicate review', async () => {
      ReviewModel.findExistingReview.mockResolvedValue(mockReview);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_REVIEW',
      });

      expect(ReviewModel.createReview).not.toHaveBeenCalled();
      // No review came out of the attempt — the slot goes back
      expect(decrement).toHaveBeenCalledWith('reviews:ratelimit:user-123');
    });

    test('should handle database unique constraint violation', async () => {
      const error = new Error('Duplicate key');
      error.code = '23505';
      ReviewModel.createReview.mockRejectedValue(error);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_REVIEW',
      });
      expect(decrement).toHaveBeenCalledWith('reviews:ratelimit:user-123');
    });

    test('should handle foreign key violation', async () => {
      const error = new Error('Foreign key violation');
      error.code = '23503';
      ReviewModel.createReview.mockRejectedValue(error);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_REFERENCE',
      });
    });

    test('should handle check constraint violation', async () => {
      const error = new Error('Check constraint violation');
      error.code = '23514';
      ReviewModel.createReview.mockRejectedValue(error);

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 400,
        code: 'CONSTRAINT_VIOLATION',
      });
    });

    test('should update establishment aggregates inside the creation transaction', async () => {
      await createReview(validReviewData);

      // Verify aggregates updated during create flow, on the transaction client
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith('estab-123', TX_CLIENT);
    });

    test('the account switched off while the review was on its way: 403, no review, slot back', async () => {
      // A block from the panel committed between the checks above and the
      // transaction: the share-locked re-read sees it (Phase 3.5 review).
      TX_CLIENT.query.mockResolvedValue({ rows: [{ is_active: false }] });

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 403,
        code: 'USER_INACTIVE',
      });

      expect(TX_CLIENT.query).toHaveBeenCalledWith(
        'SELECT is_active FROM users WHERE id = $1 FOR SHARE',
        ['user-123'],
      );
      expect(ReviewModel.createReview).not.toHaveBeenCalled();
      expect(decrement).toHaveBeenCalledWith('reviews:ratelimit:user-123');
    });

    test('a failed recalculation gives the quota slot back', async () => {
      ReviewModel.updateEstablishmentAggregates.mockRejectedValue(new Error('recalc failed'));

      await expect(createReview(validReviewData)).rejects.toMatchObject({
        statusCode: 500,
        code: 'REVIEW_CREATION_FAILED',
      });

      expect(decrement).toHaveBeenCalledWith('reviews:ratelimit:user-123');
    });

    test('should reserve the rate limit slot before creation', async () => {
      await createReview(validReviewData);

      expect(incrementWithExpiry).toHaveBeenCalledWith(
        'reviews:ratelimit:user-123',
        expect.any(Number) // seconds until Minsk midnight
      );
    });

    test('should fetch complete review with author information', async () => {
      const reviewWithAuthor = {
        ...mockReview,
        author_name: 'Test User',
        author_email: 'user@test.com',
      };

      ReviewModel.findReviewById.mockResolvedValue(reviewWithAuthor);

      const result = await createReview(validReviewData);

      expect(result).toEqual(reviewWithAuthor);
      expect(ReviewModel.findReviewById).toHaveBeenCalledWith(mockReview.id);
    });
  });

  describe('updateReview', () => {
    const reviewId = 'review-123';
    const userId = 'user-123';
    const updates = {
      rating: 4,
      content: 'Updated review content',
    };

    const mockReview = createMockReview({
      id: reviewId,
      user_id: userId,
      rating: 5,
      content: 'Original content',
    });

    beforeEach(() => {
      ReviewModel.findReviewById
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce({ ...mockReview, ...updates });
      ReviewModel.updateReview.mockResolvedValue({ ...mockReview, ...updates });
      ReviewModel.updateEstablishmentAggregates.mockResolvedValue(undefined);
    });

    test('should update review when user owns it', async () => {
      const result = await updateReview(reviewId, userId, updates);

      expect(result).toMatchObject(updates);
      expect(ReviewModel.updateReview).toHaveBeenCalledWith(reviewId, updates);

      // Verify aggregates updated
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith(
        mockReview.establishment_id
      );
    });

    test('should throw error when review not found', async () => {
      ReviewModel.findReviewById.mockReset();
      ReviewModel.findReviewById.mockResolvedValue(null);

      await expect(updateReview(reviewId, userId, updates)).rejects.toMatchObject({
        statusCode: 404,
        code: 'REVIEW_NOT_FOUND',
      });

      expect(ReviewModel.updateReview).not.toHaveBeenCalled();
    });

    test('should throw error when user does not own review', async () => {
      await expect(updateReview(reviewId, 'different-user', updates)).rejects.toMatchObject({
        statusCode: 403,
        code: 'UNAUTHORIZED_REVIEW_MODIFICATION',
      });

      expect(ReviewModel.updateReview).not.toHaveBeenCalled();
    });

    test('should update aggregates when rating changes', async () => {
      await updateReview(reviewId, userId, { rating: 3 });

      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalled();
    });

    test('should throw error when no fields provided', async () => {
      await expect(updateReview(reviewId, userId, {})).rejects.toMatchObject({
        statusCode: 400,
        code: 'NO_UPDATE_FIELDS',
      });

      expect(ReviewModel.updateReview).not.toHaveBeenCalled();
    });

    test('recounts the rating even when only the text changed (the trigger counts hidden reviews)', async () => {
      ReviewModel.findReviewById
        .mockReset()
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce({ ...mockReview, content: 'Only content changed' });
      ReviewModel.updateReview.mockResolvedValue({ ...mockReview, content: 'Only content changed' });

      await updateReview(reviewId, userId, { content: 'Only content changed' });

      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith(mockReview.establishment_id);
    });

    test('should map constraint violation to app error', async () => {
      const dbError = new Error('constraint');
      dbError.code = '23514';
      ReviewModel.updateReview.mockRejectedValue(dbError);

      await expect(updateReview(reviewId, userId, updates)).rejects.toMatchObject({
        statusCode: 400,
        code: 'CONSTRAINT_VIOLATION',
      });
    });
  });

  describe('deleteReview', () => {
    const reviewId = 'review-123';
    const userId = 'user-123';
    const mockReview = createMockReview({ id: reviewId, user_id: userId });

    beforeEach(() => {
      ReviewModel.findReviewById.mockResolvedValue(mockReview);
      ReviewModel.softDeleteReview.mockResolvedValue(true);
      ReviewModel.updateEstablishmentAggregates.mockResolvedValue(undefined);
    });

    test('should soft delete review when user owns it', async () => {
      await deleteReview(reviewId, userId);

      expect(ReviewModel.softDeleteReview).toHaveBeenCalledWith(reviewId);

      // Verify aggregates updated after deletion
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith(
        mockReview.establishment_id
      );
    });

    test('should throw error when user does not own review', async () => {
      await expect(deleteReview(reviewId, 'different-user')).rejects.toMatchObject({
        statusCode: 403,
        code: 'UNAUTHORIZED_REVIEW_DELETION',
      });

      expect(ReviewModel.softDeleteReview).not.toHaveBeenCalled();
    });

    test('should throw error when review not found', async () => {
      ReviewModel.findReviewById.mockResolvedValue(null);

      await expect(deleteReview(reviewId, userId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'REVIEW_NOT_FOUND',
      });
    });

    test('should handle already deleted review', async () => {
      ReviewModel.softDeleteReview.mockResolvedValue(false);

      await expect(deleteReview(reviewId, userId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'REVIEW_NOT_FOUND',
      });
    });
  });

  describe('getReviewsByEstablishment', () => {
    const establishmentId = 'estab-123';
    beforeEach(() => {
      ReviewModel.establishmentExists.mockResolvedValue(true);
    });

    test('should fetch reviews with pagination', async () => {
      const rawReviews = [
        {
          id: 'r1',
          establishment_id: 'estab-123',
          user_id: 'u1',
          rating: 4,
          content: 'Great place!',
          is_edited: false,
          created_at: new Date(),
          updated_at: new Date(),
          author_name: 'Alice',
          author_avatar: null,
        },
        {
          id: 'r2',
          establishment_id: 'estab-123',
          user_id: 'u2',
          rating: 5,
          content: 'Great place!',
          is_edited: false,
          created_at: new Date(),
          updated_at: new Date(),
          author_name: 'Bob',
          author_avatar: null,
        },
      ];

      ReviewModel.findReviewsByEstablishment.mockResolvedValue(rawReviews);
      ReviewModel.countReviewsByEstablishment.mockResolvedValue(15);

      const result = await getEstablishmentReviews(establishmentId, {
        page: 1,
        limit: 10,
      });

      expect(result.reviews).toHaveLength(2);
      expect(result.reviews[0]).toMatchObject({
        id: 'r1',
        author: { id: 'u1', name: 'Alice', avatar_url: null },
      });
      expect(result.reviews[1]).toMatchObject({
        id: 'r2',
        author: { id: 'u2', name: 'Bob', avatar_url: null },
      });
      expect(result.pagination).toEqual({
        total: 15,
        page: 1,
        limit: 10,
        pages: 2,
        hasNext: true,
        hasPrevious: false,
      });
    });

    // The body pins pass-through, not a cap: the cap of 50 lives before the
    // service (validators/reviewValidation.js, reviewController.js) — the old
    // name «should enforce maximum limit» promised what this layer does not do.
    test('passes the limit through to the model as given — the cap lives before the service', async () => {
      ReviewModel.findReviewsByEstablishment.mockResolvedValue([]);
      ReviewModel.countReviewsByEstablishment.mockResolvedValue(0);

      await getEstablishmentReviews(establishmentId, { limit: 200 });

      expect(ReviewModel.findReviewsByEstablishment).toHaveBeenCalledWith(
        establishmentId,
        expect.objectContaining({ limit: 200 })
      );
    });

    test('should default to newest sort when invalid sort provided', async () => {
      ReviewModel.findReviewsByEstablishment.mockResolvedValue([]);
      ReviewModel.countReviewsByEstablishment.mockResolvedValue(0);

      await getEstablishmentReviews(establishmentId, { sort: 'invalid', page: 2, limit: 5 });

      expect(ReviewModel.findReviewsByEstablishment).toHaveBeenCalledWith(
        establishmentId,
        expect.objectContaining({ sortBy: 'newest', offset: 5, limit: 5 })
      );
    });

    test('should throw when establishment does not exist', async () => {
      ReviewModel.establishmentExists.mockResolvedValue(false);

      await expect(getEstablishmentReviews(establishmentId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });
    });
  });

  describe('getReviewById', () => {
    test('should return review when found', async () => {
      const review = createMockReview({ id: 'review-1' });
      ReviewModel.findReviewById.mockResolvedValue(review);

      const result = await getReviewById('review-1');

      expect(result).toEqual(review);
      expect(ReviewModel.findReviewById).toHaveBeenCalledWith('review-1');
    });

    test('should throw when review missing', async () => {
      ReviewModel.findReviewById.mockResolvedValue(null);

      await expect(getReviewById('missing')).rejects.toMatchObject({
        statusCode: 404,
        code: 'REVIEW_NOT_FOUND',
      });
    });

    test('should throw 404 for a soft-deleted review (single-fetch parity, OSB-I2)', async () => {
      ReviewModel.findReviewById.mockResolvedValue(
        createMockReview({ is_deleted: true }),
      );

      await expect(getReviewById('deleted')).rejects.toMatchObject({
        statusCode: 404,
        code: 'REVIEW_NOT_FOUND',
      });
    });

    test('should throw 404 for a moderator-hidden review', async () => {
      ReviewModel.findReviewById.mockResolvedValue(
        createMockReview({ is_visible: false }),
      );

      await expect(getReviewById('hidden')).rejects.toMatchObject({
        statusCode: 404,
        code: 'REVIEW_NOT_FOUND',
      });
    });
  });

  describe('getUserReviews', () => {
    const userId = 'user-1';
    const reviews = [
      {
        id: 'r1',
        establishment_id: 'e1',
        rating: 4,
        content: 'Solid',
        is_edited: false,
        created_at: new Date(),
        updated_at: new Date(),
        establishment_name: 'Test Restaurant',
        establishment_city: 'Минск',
        // The row as reviewModel.findReviewsByUser returns it: `categories`
        // of the place as an array (D8 — the fixture used to speak the
        // service's own `establishment_category`, so it stayed green while
        // the live answer never had a type).
        establishment_categories: ['Ресторан', 'Бар'],
      },
    ];

    test('should return formatted reviews with pagination', async () => {
      ReviewModel.getUserById.mockResolvedValue(createMockUser({ id: userId }));
      ReviewModel.findReviewsByUser.mockResolvedValue(reviews);
      ReviewModel.countReviewsByUser.mockResolvedValue(1);

      const result = await getUserReviews(userId, { page: 1, limit: 10 });

      expect(ReviewModel.findReviewsByUser).toHaveBeenCalledWith(userId, { limit: 10, offset: 0 });
      expect(result.reviews[0]).toMatchObject({
        id: 'r1',
        establishment: {
          id: 'e1',
          name: 'Test Restaurant',
          city: 'Минск',
          category: 'Ресторан',
        },
      });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        pages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });

    test('should throw when user not found', async () => {
      ReviewModel.getUserById.mockResolvedValue(null);

      await expect(getUserReviews(userId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });
    });
  });

  describe('getEstablishmentAggregates', () => {
    const establishmentId = 'estab-1';

    test('should return aggregates when establishment exists', async () => {
      ReviewModel.establishmentExists.mockResolvedValue(true);
      ReviewModel.updateEstablishmentAggregates.mockResolvedValue({
        average_rating: 4.5,
        review_count: 3,
      });

      const result = await getEstablishmentAggregates(establishmentId);

      expect(result).toEqual({ average_rating: 4.5, review_count: 3 });
      expect(ReviewModel.updateEstablishmentAggregates).toHaveBeenCalledWith(establishmentId);
    });

    test('should throw when establishment missing', async () => {
      ReviewModel.establishmentExists.mockResolvedValue(false);

      await expect(getEstablishmentAggregates(establishmentId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });
    });
  });

  describe('getUserReviewQuota', () => {
    test('should return quota breakdown', async () => {
      getCounter.mockResolvedValue(4);

      const result = await getUserReviewQuota('user-1');

      expect(result).toMatchObject({
        limit: 10,
        used: 4,
        remaining: 6,
      });
      expect(result.resetIn).toBeGreaterThanOrEqual(1);
      expect(result.resetIn).toBeLessThanOrEqual(86400);
      expect(getCounter).toHaveBeenCalledWith('reviews:ratelimit:user-1');
    });
  });
});
