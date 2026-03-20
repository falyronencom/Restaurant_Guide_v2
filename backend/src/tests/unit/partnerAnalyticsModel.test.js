/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: partnerAnalyticsModel.js
 *
 * Tests SQL query construction and result transformation with mocked pool.
 * Covers: trackView, trackFavorite, trackCall, getMetricsInPeriod,
 * getReviewMetricsInPeriod, getEventTimeline, getReviewTimeline,
 * getRatingDistribution, getPartnerEstablishments, verifyOwnership.
 */

import { jest } from '@jest/globals';

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

const Model = await import('../../models/partnerAnalyticsModel.js');

// ============================================================================
// Helpers
// ============================================================================

const EST_ID = 'est-uuid-1';
const PARTNER_ID = 'partner-uuid-1';

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// Event Tracking
// ============================================================================

describe('trackView', () => {
  it('executes UPSERT query with establishment ID', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await Model.trackView(EST_ID);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('view_count');
    expect(params).toEqual([EST_ID]);
  });

  it('does not throw on query error (fire-and-forget)', async () => {
    mockQuery.mockRejectedValue(new Error('DB error'));
    await expect(Model.trackView(EST_ID)).resolves.toBeUndefined();
  });
});

describe('trackFavorite', () => {
  it('executes UPSERT with positive delta', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await Model.trackFavorite(EST_ID, 1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('favorite_count');
    expect(sql).toContain('GREATEST');
    expect(params).toEqual([EST_ID, 1]);
  });

  it('executes UPSERT with negative delta', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await Model.trackFavorite(EST_ID, -1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([EST_ID, -1]);
  });

  it('does not throw on query error', async () => {
    mockQuery.mockRejectedValue(new Error('DB error'));
    await expect(Model.trackFavorite(EST_ID, 1)).resolves.toBeUndefined();
  });
});

describe('trackCall', () => {
  it('executes UPSERT for call_count', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await Model.trackCall(EST_ID);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('call_count');
    expect(sql).toContain('ON CONFLICT');
    expect(params).toEqual([EST_ID]);
  });
});

// ============================================================================
// Analytics Queries
// ============================================================================

describe('getMetricsInPeriod', () => {
  it('returns empty object for empty ID list', async () => {
    const result = await Model.getMetricsInPeriod([], new Date(), new Date());
    expect(result).toEqual({});
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns map of establishment_id to metrics', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { establishment_id: EST_ID, views: 10, favorites: 2, calls: 1 },
      ],
    });
    const result = await Model.getMetricsInPeriod(
      [EST_ID], new Date('2026-03-01'), new Date('2026-03-15')
    );
    expect(result[EST_ID]).toEqual({ views: 10, favorites: 2, calls: 1 });
  });
});

describe('getReviewMetricsInPeriod', () => {
  it('returns empty object for empty ID list', async () => {
    const result = await Model.getReviewMetricsInPeriod([], new Date(), new Date());
    expect(result).toEqual({});
  });

  it('returns map with parsed average_rating', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ establishment_id: EST_ID, reviews: 5, average_rating: '4.20' }],
    });
    const result = await Model.getReviewMetricsInPeriod(
      [EST_ID], new Date('2026-03-01'), new Date('2026-03-15')
    );
    expect(result[EST_ID].reviews).toBe(5);
    expect(result[EST_ID].average_rating).toBe(4.2);
  });
});

describe('getEventTimeline', () => {
  it('returns rows ordered by date', async () => {
    const rows = [
      { date: '2026-03-01', views: 5, favorites: 1, calls: 0 },
      { date: '2026-03-02', views: 3, favorites: 0, calls: 1 },
    ];
    mockQuery.mockResolvedValue({ rows });

    const result = await Model.getEventTimeline(
      EST_ID, new Date('2026-03-01'), new Date('2026-03-03'), 'day'
    );
    expect(result).toEqual(rows);
  });

  it('uses DATE_TRUNC for week aggregation', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await Model.getEventTimeline(EST_ID, new Date(), new Date(), 'week');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("DATE_TRUNC('week'");
  });
});

describe('getReviewTimeline', () => {
  it('queries reviews table with visibility filters', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await Model.getReviewTimeline(EST_ID, new Date(), new Date(), 'day');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('is_deleted = false');
    expect(sql).toContain('is_visible = true');
  });
});

describe('getRatingDistribution', () => {
  it('returns full 1-5 distribution with zeros for missing ratings', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { rating: 4, count: 3 },
        { rating: 5, count: 7 },
      ],
    });

    const result = await Model.getRatingDistribution(EST_ID);

    expect(result.distribution).toHaveLength(5);
    expect(result.distribution[0]).toEqual({ rating: 1, count: 0, percentage: 0 });
    expect(result.distribution[3].count).toBe(3); // rating 4
    expect(result.distribution[4].count).toBe(7); // rating 5
    expect(result.total_reviews).toBe(10);
    expect(result.average).toBeCloseTo(4.7, 1);
  });

  it('returns zeros when no reviews', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await Model.getRatingDistribution(EST_ID);
    expect(result.total_reviews).toBe(0);
    expect(result.average).toBe(0);
    result.distribution.forEach(d => {
      expect(d.count).toBe(0);
      expect(d.percentage).toBe(0);
    });
  });
});

// ============================================================================
// Ownership & Partner Queries
// ============================================================================

describe('verifyOwnership', () => {
  it('returns true when establishment belongs to partner', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const result = await Model.verifyOwnership(EST_ID, PARTNER_ID);
    expect(result).toBe(true);
  });

  it('returns false when no match', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await Model.verifyOwnership(EST_ID, PARTNER_ID);
    expect(result).toBe(false);
  });
});

describe('getPartnerEstablishments', () => {
  it('returns establishments with active or suspended status', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: EST_ID, name: 'Test', view_count: 10, favorite_count: 2, review_count: 1, average_rating: '4.00' },
      ],
    });

    const result = await Model.getPartnerEstablishments(PARTNER_ID);
    expect(result).toHaveLength(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("'active'");
    expect(sql).toContain("'suspended'");
  });
});
