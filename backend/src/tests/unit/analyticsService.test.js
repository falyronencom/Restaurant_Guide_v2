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
 * fillDateGaps note: windows are whole UTC days and buckets are keyed by the
 * calendar date SQL groups by ('YYYY-MM-DD'). Assertions state those dates
 * literally, so they mean the same thing on UTC and on UTC+3.
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

  // Durations are asserted exactly, not «approximately»: the point of the
  // stage-6 change is that «N дней» is N whole days. A loose bound here is what
  // let 30d quietly mean 30.5 and get bucketed by week.

  test('7d — current period is exactly 7 days', () => {
    const { startDate, endDate } = parsePeriod('7d');
    expect(endDate.getTime() - startDate.getTime()).toBe(7 * ONE_DAY_MS);
  });

  test('30d — current period is exactly 30 days', () => {
    const { startDate, endDate } = parsePeriod('30d');
    expect(endDate.getTime() - startDate.getTime()).toBe(30 * ONE_DAY_MS);
  });

  test('90d — current period is exactly 90 days', () => {
    const { startDate, endDate } = parsePeriod('90d');
    expect(endDate.getTime() - startDate.getTime()).toBe(90 * ONE_DAY_MS);
  });

  test('undefined period defaults to 30 days', () => {
    const { startDate, endDate } = parsePeriod(undefined);
    expect(endDate.getTime() - startDate.getTime()).toBe(30 * ONE_DAY_MS);
  });

  // Bounds land on UTC midnight regardless of the process timezone. This is the
  // assertion that keeps a developer's machine honest: the timelines bucket by
  // `DATE(created_at)`, i.e. UTC days, and a window measured in local days would
  // agree with them on production (UTC) and nowhere else.

  test('preset window sits on whole UTC days', () => {
    const { startDate, endDate } = parsePeriod('7d');
    expect(startDate.toISOString()).toBe('2026-01-26T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2026-02-02T00:00:00.000Z');
  });

  test('preset window ends with today, not with the current instant', () => {
    jest.setSystemTime(new Date('2026-02-01T17:45:12.000Z'));
    const { endDate } = parsePeriod('7d');
    expect(endDate.toISOString()).toBe('2026-02-02T00:00:00.000Z');
    jest.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
  });

  test('custom from/to — startDate is UTC midnight of the from day', () => {
    const result = parsePeriod(undefined, '2026-01-01', '2026-01-31');
    expect(result.startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('custom from/to — the day named by `to` is inside the window', () => {
    const result = parsePeriod(undefined, '2026-01-01', '2026-01-31');
    // Exclusive bound is the midnight after 31 January: asking for a range that
    // ends today and not getting today is the failure this pins.
    expect(result.endDate.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  test('custom from/to — a single day is a one-day window', () => {
    const result = parsePeriod(undefined, '2026-01-15', '2026-01-15');
    expect(result.endDate.getTime() - result.startDate.getTime()).toBe(ONE_DAY_MS);
  });

  test('custom from/to — full ISO timestamps are read as their UTC day', () => {
    const result = parsePeriod(
      undefined,
      '2026-01-01T00:00:00.000',
      '2026-01-31T00:00:00.000',
    );
    expect(result.startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(result.endDate.toISOString()).toBe('2026-02-01T00:00:00.000Z');
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
  // Windows come from parsePeriod, i.e. true UTC midnights — the tests build
  // them the same way. The previous edition constructed local midnights and
  // leaned on a loopDateKey() helper that mirrored the loop's own arithmetic,
  // which made every assertion self-consistent and none of them true: the
  // helper agreed with the code by construction, including where the code was
  // wrong. Keys here are plain calendar dates, the way SQL hands them over.
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2026, 0, 4);

  const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

  test('fills missing dates with zero-count entries', () => {
    const data = [{ date: '2026-01-02', count: 5 }];
    const result = fillDateGaps(data, new Date(start), new Date(end), 'day');

    expect(result.map(r => r.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(result.map(r => r.count)).toEqual([0, 5, 0]);
  });

  test('empty data array → all entries have count 0', () => {
    const result = fillDateGaps([], new Date(start), new Date(end), 'day');
    expect(result).toHaveLength(3);
    expect(result.every(r => r.count === 0)).toBe(true);
  });

  test('complete data (no gaps) → values pass through unchanged', () => {
    const data = [
      { date: '2026-01-01', count: 10 },
      { date: '2026-01-02', count: 20 },
      { date: '2026-01-03', count: 30 },
    ];
    const result = fillDateGaps(data, new Date(start), new Date(end), 'day');
    expect(result.map(r => r.count)).toEqual([10, 20, 30]);
  });

  test('extra fields — null for gap entries, parseFloat for present entries', () => {
    const data = [{ date: '2026-01-02', count: 3, average_rating: '4.50' }];
    const result = fillDateGaps(data, new Date(start), new Date(end), 'day', ['average_rating']);

    expect(result[0].average_rating).toBeNull();
    expect(result[1].average_rating).toBe(4.5);
    expect(result[2].average_rating).toBeNull();
  });

  test('output is sorted chronologically regardless of input data order', () => {
    const data = [
      { date: '2026-01-03', count: 99 },
      { date: '2026-01-01', count: 1 },
    ];
    const result = fillDateGaps(data, new Date(start), new Date(end), 'day');
    expect(result.map(r => r.count)).toEqual([1, 0, 99]);
  });

  // The buckets have to land on the same keys SQL groups by, or the series is
  // a row of zeros next to a non-zero metric card. `DATE_TRUNC('week')` returns
  // Mondays and `DATE_TRUNC('month')` returns first-of-months; stepping from an
  // arbitrary start date hits neither.

  test('week buckets start on Monday, whatever weekday the window starts', () => {
    // 29 May 2026 is a Friday.
    const result = fillDateGaps([], utc(2026, 5, 29), utc(2026, 6, 12), 'week');

    expect(result.map(r => r.date)).toEqual(['2026-05-25', '2026-06-01', '2026-06-08']);
  });

  test('week counts land in their buckets instead of vanishing', () => {
    // Exactly what DATE_TRUNC('week') hands back for that window.
    const data = [
      { date: '2026-05-25', count: 7 },
      { date: '2026-06-01', count: 4 },
      { date: '2026-06-08', count: 9 },
    ];
    const result = fillDateGaps(data, utc(2026, 5, 29), utc(2026, 6, 12), 'week');

    expect(result.reduce((sum, r) => sum + r.count, 0)).toBe(20);
  });

  test('month buckets start on the first, whatever day the window starts', () => {
    const data = [{ date: '2026-02-01', count: 12 }];
    const result = fillDateGaps(data, utc(2026, 1, 17), utc(2026, 4, 3), 'month');

    expect(result.map(r => r.date))
      .toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(result[1].count).toBe(12);
  });

  test('a DATE handed over by node-pg keeps its calendar day', () => {
    // node-pg turns a DATE column into local midnight; reading it back through
    // toISOString() moves the key a day earlier on any process east of UTC.
    const data = [{ date: new Date(2026, 0, 2), count: 5 }];
    const result = fillDateGaps(data, new Date(start), new Date(end), 'day');

    expect(result[1].date).toBe('2026-01-02');
    expect(result[1].count).toBe(5);
  });
});
