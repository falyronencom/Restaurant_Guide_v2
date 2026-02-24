/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: analyticsService.js — Pure Functions
 *
 * Tests computational core functions that require no database:
 *   parsePeriod        — period string/custom range → date range + comparison range
 *   getAggregationType — date range → 'day' | 'week' | 'month'
 *   computeChangePercent — change % with null-safe division
 *   fillDateGaps       — sparse time-series → dense continuous series
 *
 * No database connection. AnalyticsModel is mocked entirely.
 * Time frozen at 2026-02-01T00:00:00.000Z for deterministic date assertions.
 *
 * fillDateGaps note: the function uses local midnight (setHours) internally.
 * Tests use a loopDateKey() helper that mirrors the loop's date-to-string
 * conversion, making assertions timezone-independent (UTC and UTC+3 both pass).
 */

import { jest } from '@jest/globals';

// Mock all module-level dependencies before importing the service.
// The pure functions (parsePeriod, getAggregationType, computeChangePercent,
// fillDateGaps) do not call any of these at runtime, but analyticsService.js
// imports them at module load time.
jest.unstable_mockModule('../../models/analyticsModel.js', () => ({}));

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

// Dynamic import after mocks are registered
const {
  parsePeriod,
  getAggregationType,
  computeChangePercent,
  fillDateGaps,
} = await import('../../services/analyticsService.js');

// ============================================================================
// Helpers
// ============================================================================

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a date key the same way fillDateGaps loop does:
 *   new Date(year, month-1, day) → setHours(0,0,0,0) → toISOString().split('T')[0]
 *
 * Using this helper for both the startDate and the test data rows ensures that
 * the Map lookup inside fillDateGaps finds matches regardless of the server
 * timezone (UTC or UTC+3).
 */
const loopDateKey = (year, month, day) => {
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
};

// ============================================================================
// parsePeriod
// ============================================================================

describe('parsePeriod', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('returns an object with startDate, endDate, prevStart, prevEnd Date instances', () => {
    const result = parsePeriod('7d');
    expect(result.startDate).toBeInstanceOf(Date);
    expect(result.endDate).toBeInstanceOf(Date);
    expect(result.prevStart).toBeInstanceOf(Date);
    expect(result.prevEnd).toBeInstanceOf(Date);
  });

  test('startDate < endDate', () => {
    const { startDate, endDate } = parsePeriod('30d');
    expect(startDate.getTime()).toBeLessThan(endDate.getTime());
  });

  test('7d — current period is approximately 7 days', () => {
    const { startDate, endDate } = parsePeriod('7d');
    const duration = endDate.getTime() - startDate.getTime();
    expect(duration).toBeGreaterThanOrEqual(7 * ONE_DAY_MS);
    expect(duration).toBeLessThan(8 * ONE_DAY_MS);
  });

  test('30d — current period is approximately 30 days', () => {
    const { startDate, endDate } = parsePeriod('30d');
    const duration = endDate.getTime() - startDate.getTime();
    expect(duration).toBeGreaterThanOrEqual(30 * ONE_DAY_MS);
    expect(duration).toBeLessThan(31 * ONE_DAY_MS);
  });

  test('90d — current period is approximately 90 days', () => {
    const { startDate, endDate } = parsePeriod('90d');
    const duration = endDate.getTime() - startDate.getTime();
    expect(duration).toBeGreaterThanOrEqual(90 * ONE_DAY_MS);
    expect(duration).toBeLessThan(91 * ONE_DAY_MS);
  });

  test('undefined period defaults to 30 days', () => {
    const { startDate, endDate } = parsePeriod(undefined);
    const duration = endDate.getTime() - startDate.getTime();
    expect(duration).toBeGreaterThanOrEqual(30 * ONE_DAY_MS);
    expect(duration).toBeLessThan(31 * ONE_DAY_MS);
  });

  test('custom from/to — startDate matches the from parameter', () => {
    const result = parsePeriod(undefined, '2026-01-01', '2026-01-31');
    expect(result.startDate.getTime()).toBe(new Date('2026-01-01').getTime());
  });

  test('custom from/to — endDate is exclusive (past start of to date, within 25h)', () => {
    const result = parsePeriod(undefined, '2026-01-01', '2026-01-31');
    // endDate = new Date('2026-01-31') → setHours(23,59,59,999) LOCAL → +1ms
    // In any timezone, endDate must be after UTC midnight of Jan 31 and within 25h of it
    // (25h covers UTC-12 where local end-of-day = 23:59 local = 11:59 UTC next day)
    const toUtcMidnight = new Date('2026-01-31').getTime();
    expect(result.endDate.getTime()).toBeGreaterThan(toUtcMidnight);
    expect(result.endDate.getTime()).toBeLessThanOrEqual(toUtcMidnight + 25 * 60 * 60 * 1000);
  });

  test('prevEnd equals startDate — comparison period ends where current begins', () => {
    const result = parsePeriod('7d');
    expect(result.prevEnd.getTime()).toBe(result.startDate.getTime());
  });

  test('comparison period has the same duration as the current period', () => {
    const result = parsePeriod('30d');
    const currentDuration = result.endDate.getTime() - result.startDate.getTime();
    const prevDuration = result.prevEnd.getTime() - result.prevStart.getTime();
    expect(prevDuration).toBe(currentDuration);
  });

  test('prevStart precedes prevEnd', () => {
    const result = parsePeriod('30d');
    expect(result.prevStart.getTime()).toBeLessThan(result.prevEnd.getTime());
  });
});

// ============================================================================
// getAggregationType
// ============================================================================

describe('getAggregationType', () => {
  // Creates a date pair exactly N days apart using milliseconds
  // (integer days → no DST or local-midnight ambiguity)
  const makeRange = (days) => {
    const start = new Date(2026, 0, 1); // local Jan 1 midnight
    const end = new Date(start.getTime() + days * ONE_DAY_MS);
    return { start, end };
  };

  test('7-day range → day', () => {
    const { start, end } = makeRange(7);
    expect(getAggregationType(start, end)).toBe('day');
  });

  test('30-day range → day (upper boundary of day bucket)', () => {
    const { start, end } = makeRange(30);
    expect(getAggregationType(start, end)).toBe('day');
  });

  test('31-day range → week (lower boundary of week bucket)', () => {
    const { start, end } = makeRange(31);
    expect(getAggregationType(start, end)).toBe('week');
  });

  test('90-day range → week (upper boundary of week bucket)', () => {
    const { start, end } = makeRange(90);
    expect(getAggregationType(start, end)).toBe('week');
  });

  test('91-day range → month (lower boundary of month bucket)', () => {
    const { start, end } = makeRange(91);
    expect(getAggregationType(start, end)).toBe('month');
  });
});

// ============================================================================
// computeChangePercent
// ============================================================================

describe('computeChangePercent', () => {
  test('positive growth: (150, 100) → 50', () => {
    expect(computeChangePercent(150, 100)).toBe(50);
  });

  test('negative growth: (80, 100) → -20', () => {
    expect(computeChangePercent(80, 100)).toBe(-20);
  });

  test('full drop: (0, 100) → -100', () => {
    expect(computeChangePercent(0, 100)).toBe(-100);
  });

  test('no change: (100, 100) → 0', () => {
    expect(computeChangePercent(100, 100)).toBe(0);
  });

  test('zero previous, nonzero current → null (division by zero avoidance)', () => {
    expect(computeChangePercent(100, 0)).toBeNull();
  });

  test('both zero → 0 (zero previous, zero current)', () => {
    expect(computeChangePercent(0, 0)).toBe(0);
  });

  test('result is rounded to 1 decimal place', () => {
    // 2/3 - 1 = -0.333... → -33.3%
    expect(computeChangePercent(2, 3)).toBe(-33.3);
  });
});

// ============================================================================
// fillDateGaps
// ============================================================================

describe('fillDateGaps', () => {
  // 3-day window: local Jan 1, Jan 2, Jan 3 (Jan 4 is excluded by < condition)
  const start = new Date(2026, 0, 1); // local midnight Jan 1
  const end = new Date(2026, 0, 4); // local midnight Jan 4

  test('fills missing dates with zero-count entries', () => {
    // Only Jan 2 has data → Jan 1 and Jan 3 must be filled with zeros
    const data = [{ date: loopDateKey(2026, 1, 2), count: 5 }];
    const result = fillDateGaps(data, start, end, 'day');

    expect(result).toHaveLength(3);
    expect(result[0].count).toBe(0); // Jan 1 — gap
    expect(result[1].count).toBe(5); // Jan 2 — data
    expect(result[2].count).toBe(0); // Jan 3 — gap
  });

  test('empty data array → all entries have count 0', () => {
    const result = fillDateGaps([], start, end, 'day');
    expect(result).toHaveLength(3);
    expect(result.every(r => r.count === 0)).toBe(true);
  });

  test('complete data (no gaps) → values pass through unchanged', () => {
    const data = [
      { date: loopDateKey(2026, 1, 1), count: 10 },
      { date: loopDateKey(2026, 1, 2), count: 20 },
      { date: loopDateKey(2026, 1, 3), count: 30 },
    ];
    const result = fillDateGaps(data, start, end, 'day');

    expect(result).toHaveLength(3);
    expect(result[0].count).toBe(10);
    expect(result[1].count).toBe(20);
    expect(result[2].count).toBe(30);
  });

  test('extra fields — null for gap entries, parseFloat for present entries', () => {
    const data = [{ date: loopDateKey(2026, 1, 2), count: 3, average_rating: '4.50' }];
    const result = fillDateGaps(data, start, end, 'day', ['average_rating']);

    expect(result[0].average_rating).toBeNull(); // gap
    expect(result[1].average_rating).toBe(4.5);  // parsed from string
    expect(result[2].average_rating).toBeNull(); // gap
  });

  test('week aggregation — advances by 7 days per bucket', () => {
    // 3-week range: Jan 1 to Jan 22 → buckets at Jan 1, Jan 8, Jan 15
    const weekStart = new Date(2026, 0, 1);
    const weekEnd = new Date(2026, 0, 22);
    const data = [{ date: loopDateKey(2026, 1, 8), count: 7 }];
    const result = fillDateGaps(data, weekStart, weekEnd, 'week');

    expect(result).toHaveLength(3);
    expect(result[0].count).toBe(0); // week starting Jan 1 — gap
    expect(result[1].count).toBe(7); // week starting Jan 8 — data
    expect(result[2].count).toBe(0); // week starting Jan 15 — gap
  });

  test('output is sorted chronologically regardless of input data order', () => {
    // Input data in reverse order: Jan 3 before Jan 1
    const data = [
      { date: loopDateKey(2026, 1, 3), count: 99 },
      { date: loopDateKey(2026, 1, 1), count: 1 },
    ];
    const result = fillDateGaps(data, start, end, 'day');

    expect(result[0].count).toBe(1);  // Jan 1 — first chronologically
    expect(result[1].count).toBe(0);  // Jan 2 — gap
    expect(result[2].count).toBe(99); // Jan 3 — last chronologically
  });
});
