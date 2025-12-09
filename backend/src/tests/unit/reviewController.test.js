/**
 * Unit Tests: reviewController.js
 *
 * Verifies controller orchestration and response formatting using mocked services.
 */

import { jest } from '@jest/globals';
import {
  createMockRequest,
  createMockResponse,
} from '../mocks/helpers.js';

jest.unstable_mockModule('../../services/reviewService.js', () => ({
  createReview: jest.fn(),
  getReviewById: jest.fn(),
  getEstablishmentReviews: jest.fn(),
  getUserReviews: jest.fn(),
  updateReview: jest.fn(),
  deleteReview: jest.fn(),
  getUserReviewQuota: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const ReviewService = await import('../../services/reviewService.js');
const ReviewController = await import('../../controllers/reviewController.js');
const logger = (await import('../../utils/logger.js')).default;

describe('reviewController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createReview uses authenticated user context and returns 201', async () => {
    const req = createMockRequest({
      body: {
        establishmentId: 'estab-1',
        rating: 5,
        content: 'Valid review content with enough length',
        user_id: 'should-be-ignored',
      },
      user: { userId: 'auth-user' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    ReviewService.createReview.mockResolvedValue({ id: 'review-1' });

    await ReviewController.createReview(req, res, next);

    expect(ReviewService.createReview).toHaveBeenCalledWith({
      user_id: 'auth-user',
      establishment_id: 'estab-1',
      rating: 5,
      content: 'Valid review content with enough length',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { review: { id: 'review-1' } },
    });
    expect(logger.info).toHaveBeenCalled();
  });

  test('getReview returns review payload', async () => {
    const req = createMockRequest({
      params: { id: 'review-123' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    ReviewService.getReviewById.mockResolvedValue({ id: 'review-123', rating: 4 });

    await ReviewController.getReview(req, res, next);

    expect(ReviewService.getReviewById).toHaveBeenCalledWith('review-123');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { review: { id: 'review-123', rating: 4 } },
    });
  });

  test('getEstablishmentReviews validates pagination inputs', async () => {
    const req = createMockRequest({
      params: { id: 'estab-1' },
      query: { page: '0', limit: '-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();

    await ReviewController.getEstablishmentReviews(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ReviewService.getEstablishmentReviews).not.toHaveBeenCalled();
  });

  test('getEstablishmentReviews forwards query params', async () => {
    const req = createMockRequest({
      params: { id: 'estab-1' },
      query: { page: '2', limit: '5', sort: 'highest' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    ReviewService.getEstablishmentReviews.mockResolvedValue({
      reviews: [],
      pagination: { page: 2, limit: 5 },
    });

    await ReviewController.getEstablishmentReviews(req, res, next);

    expect(ReviewService.getEstablishmentReviews).toHaveBeenCalledWith('estab-1', {
      page: 2,
      limit: 5,
      sort: 'highest',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { reviews: [], pagination: { page: 2, limit: 5 } },
    });
  });

  test('getUserReviews validates pagination inputs', async () => {
    const req = createMockRequest({
      params: { id: 'user-1' },
      query: { page: '-1', limit: '-2' },
    });
    const res = createMockResponse();
    const next = jest.fn();

    await ReviewController.getUserReviews(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ReviewService.getUserReviews).not.toHaveBeenCalled();
  });

  test('getUserReviews returns data when valid', async () => {
    const req = createMockRequest({
      params: { id: 'user-1' },
      query: { page: '1', limit: '20' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    ReviewService.getUserReviews.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 20 } });

    await ReviewController.getUserReviews(req, res, next);

    expect(ReviewService.getUserReviews).toHaveBeenCalledWith('user-1', { page: 1, limit: 20 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { reviews: [], pagination: { page: 1, limit: 20 } },
    });
  });

  test('updateReview builds updates object from provided fields', async () => {
    const req = createMockRequest({
      params: { id: 'review-1' },
      body: { rating: 3 },
      user: { userId: 'author-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    ReviewService.updateReview.mockResolvedValue({ id: 'review-1', rating: 3 });

    await ReviewController.updateReview(req, res, next);

    expect(ReviewService.updateReview).toHaveBeenCalledWith('review-1', 'author-1', { rating: 3 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { review: { id: 'review-1', rating: 3 } },
    });
  });

  test('deleteReview delegates to service', async () => {
    const req = createMockRequest({
      params: { id: 'review-1' },
      user: { userId: 'author-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    ReviewService.deleteReview.mockResolvedValue({ message: 'ok' });

    await ReviewController.deleteReview(req, res, next);

    expect(ReviewService.deleteReview).toHaveBeenCalledWith('review-1', 'author-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { message: 'ok' },
    });
  });

  test('getReviewQuota returns quota for authenticated user', async () => {
    const req = createMockRequest({
      user: { userId: 'user-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    ReviewService.getUserReviewQuota.mockResolvedValue({ limit: 10, used: 2, remaining: 8 });

    await ReviewController.getReviewQuota(req, res, next);

    expect(ReviewService.getUserReviewQuota).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { quota: { limit: 10, used: 2, remaining: 8 } },
    });
  });
});

