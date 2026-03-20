/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: partnerAnalyticsService.js
 *
 * Tests service orchestration logic with mocked model layer:
 *   trackCall       — delegates to model
 *   getOverview     — aggregates metrics per establishment
 *   getTrends       — builds time-series with gap filling
 *   getRatings      — delegates with ownership check
 *
 * PartnerAnalyticsModel and analyticsService utilities are mocked.
 */

import { jest } from '@jest/globals';

// ============================================================================
// Mocks
// ============================================================================

const mockModel = {
  trackCall: jest.fn(),
  getPartnerEstablishments: jest.fn(),
  getMetricsInPeriod: jest.fn(),
  getReviewMetricsInPeriod: jest.fn(),
  getEventTimeline: jest.fn(),
  getReviewTimeline: jest.fn(),
  getRatingDistribution: jest.fn(),
  verifyOwnership: jest.fn(),
};

jest.unstable_mockModule('../../models/partnerAnalyticsModel.js', () => mockModel);

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
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

// analyticsService pure functions — use real implementations
jest.unstable_mockModule('../../models/analyticsModel.js', () => ({}));

const {
  trackCall,
  getOverview,
  getTrends,
  getRatings,
} = await import('../../services/partnerAnalyticsService.js');

// ============================================================================
// Helpers
// ============================================================================

const PARTNER_ID = 'partner-uuid-1';
const EST_ID_1 = 'est-uuid-1';
const EST_ID_2 = 'est-uuid-2';

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// trackCall
// ============================================================================

describe('trackCall', () => {
  it('delegates to model.trackCall', async () => {
    mockModel.trackCall.mockResolvedValue();
    await trackCall(EST_ID_1);
    expect(mockModel.trackCall).toHaveBeenCalledWith(EST_ID_1);
  });
});

// ============================================================================
// getOverview
// ============================================================================

describe('getOverview', () => {
  it('returns empty array when partner has no establishments', async () => {
    mockModel.getPartnerEstablishments.mockResolvedValue([]);

    const result = await getOverview(PARTNER_ID, { period: '30d' });

    expect(result).toEqual({ establishments: [] });
    expect(mockModel.getMetricsInPeriod).not.toHaveBeenCalled();
  });

  it('returns metrics for each establishment with period comparison', async () => {
    const establishments = [
      { id: EST_ID_1, name: 'Ресторан 1', view_count: 100, favorite_count: 10, review_count: 5, average_rating: '4.20' },
      { id: EST_ID_2, name: 'Кафе 2', view_count: 50, favorite_count: 3, review_count: 2, average_rating: '3.50' },
    ];
    mockModel.getPartnerEstablishments.mockResolvedValue(establishments);

    // Current period metrics
    mockModel.getMetricsInPeriod.mockResolvedValueOnce({
      [EST_ID_1]: { views: 30, favorites: 5, calls: 2 },
      [EST_ID_2]: { views: 10, favorites: 1, calls: 0 },
    });
    // Previous period metrics
    mockModel.getMetricsInPeriod.mockResolvedValueOnce({
      [EST_ID_1]: { views: 20, favorites: 3, calls: 1 },
    });
    // Current period reviews
    mockModel.getReviewMetricsInPeriod.mockResolvedValueOnce({
      [EST_ID_1]: { reviews: 3, average_rating: 4.5 },
    });
    // Previous period reviews
    mockModel.getReviewMetricsInPeriod.mockResolvedValueOnce({
      [EST_ID_1]: { reviews: 2, average_rating: 4.0 },
    });

    const result = await getOverview(PARTNER_ID, { period: '7d' });

    expect(result.establishments).toHaveLength(2);

    const est1 = result.establishments[0];
    expect(est1.establishment_id).toBe(EST_ID_1);
    expect(est1.views.total).toBe(100);
    expect(est1.views.in_period).toBe(30);
    expect(est1.views.change_percent).toBe(50); // (30-20)/20 * 100
    expect(est1.favorites.in_period).toBe(5);
    expect(est1.calls.in_period).toBe(2);
    expect(est1.reviews.in_period).toBe(3);

    // EST_ID_2 has no previous period data → change_percent from 0
    const est2 = result.establishments[1];
    expect(est2.views.in_period).toBe(10);
    expect(est2.favorites.in_period).toBe(1);
    expect(est2.reviews.in_period).toBe(0); // no reviews data
  });

  it('returns zeros for establishments with no analytics data', async () => {
    mockModel.getPartnerEstablishments.mockResolvedValue([
      { id: EST_ID_1, name: 'Новый', view_count: 0, favorite_count: 0, review_count: 0, average_rating: '0' },
    ]);
    mockModel.getMetricsInPeriod.mockResolvedValue({});
    mockModel.getReviewMetricsInPeriod.mockResolvedValue({});

    const result = await getOverview(PARTNER_ID, { period: '30d' });
    const est = result.establishments[0];

    expect(est.views.total).toBe(0);
    expect(est.views.in_period).toBe(0);
    expect(est.favorites.in_period).toBe(0);
    expect(est.calls.in_period).toBe(0);
    expect(est.reviews.in_period).toBe(0);
  });
});

// ============================================================================
// getTrends
// ============================================================================

describe('getTrends', () => {
  it('throws 404 when partner does not own establishment', async () => {
    mockModel.verifyOwnership.mockResolvedValue(false);

    await expect(
      getTrends(PARTNER_ID, EST_ID_1, { period: '7d' })
    ).rejects.toThrow('Establishment not found or access denied');
  });

  it('returns gap-filled time-series arrays', async () => {
    mockModel.verifyOwnership.mockResolvedValue(true);
    mockModel.getEventTimeline.mockResolvedValue([
      { date: '2026-03-15', views: 5, favorites: 1, calls: 0 },
      { date: '2026-03-17', views: 3, favorites: 0, calls: 1 },
    ]);
    mockModel.getReviewTimeline.mockResolvedValue([
      { date: '2026-03-16', count: 1, avg_rating: '4.00' },
    ]);

    const result = await getTrends(PARTNER_ID, EST_ID_1, {
      period: null,
      from: '2026-03-15',
      to: '2026-03-17',
    });

    expect(result.views_trend).toBeDefined();
    expect(result.favorites_trend).toBeDefined();
    expect(result.calls_trend).toBeDefined();
    expect(result.reviews_trend).toBeDefined();
    expect(result.aggregation).toBe('day');

    // Gap filling should produce entries for each day
    expect(result.views_trend.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty trends for no data', async () => {
    mockModel.verifyOwnership.mockResolvedValue(true);
    mockModel.getEventTimeline.mockResolvedValue([]);
    mockModel.getReviewTimeline.mockResolvedValue([]);

    const result = await getTrends(PARTNER_ID, EST_ID_1, { period: '7d' });

    // Should still have gap-filled zero entries
    expect(result.views_trend.length).toBeGreaterThan(0);
    result.views_trend.forEach(entry => {
      expect(entry.count).toBe(0);
    });
  });
});

// ============================================================================
// getRatings
// ============================================================================

describe('getRatings', () => {
  it('throws 404 when partner does not own establishment', async () => {
    mockModel.verifyOwnership.mockResolvedValue(false);

    await expect(
      getRatings(PARTNER_ID, EST_ID_1)
    ).rejects.toThrow('Establishment not found or access denied');
  });

  it('returns rating distribution from model', async () => {
    mockModel.verifyOwnership.mockResolvedValue(true);
    const mockDistribution = {
      distribution: [
        { rating: 1, count: 0, percentage: 0 },
        { rating: 2, count: 1, percentage: 10 },
        { rating: 3, count: 2, percentage: 20 },
        { rating: 4, count: 3, percentage: 30 },
        { rating: 5, count: 4, percentage: 40 },
      ],
      average: 3.9,
      total_reviews: 10,
    };
    mockModel.getRatingDistribution.mockResolvedValue(mockDistribution);

    const result = await getRatings(PARTNER_ID, EST_ID_1);

    expect(result).toEqual(mockDistribution);
    expect(mockModel.verifyOwnership).toHaveBeenCalledWith(EST_ID_1, PARTNER_ID);
    expect(mockModel.getRatingDistribution).toHaveBeenCalledWith(EST_ID_1);
  });
});
