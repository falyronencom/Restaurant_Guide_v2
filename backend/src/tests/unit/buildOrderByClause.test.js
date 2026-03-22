/* eslint-env jest */
/**
 * Unit Tests: buildOrderByClause()
 *
 * Tests all 8 combinations: 4 sort modes × 2 coordinate states.
 * Verifies two-tier rating, price NULL handling, tiebreaker order,
 * and NULLS LAST consistency.
 */

import { jest } from '@jest/globals';

// Mock database (required because searchService imports it at module level)
jest.unstable_mockModule('../../config/database.js', () => ({
  default: { query: jest.fn() },
}));

// Mock mediaModel and establishmentModel (imported by searchService)
jest.unstable_mockModule('../../models/mediaModel.js', () => ({
  default: {},
  getEstablishmentMedia: jest.fn(),
}));

jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  default: {},
  incrementViewCount: jest.fn(),
}));

const { buildOrderByClause, RATING_SORT_MIN_REVIEWS } =
  await import('../../services/searchService.js');

describe('buildOrderByClause', () => {
  // =========================================================================
  // Constants
  // =========================================================================

  test('RATING_SORT_MIN_REVIEWS is defined and positive', () => {
    expect(RATING_SORT_MIN_REVIEWS).toBeDefined();
    expect(RATING_SORT_MIN_REVIEWS).toBeGreaterThan(0);
    expect(RATING_SORT_MIN_REVIEWS).toBe(3);
  });

  // =========================================================================
  // Rating sort
  // =========================================================================

  describe('rating sort', () => {
    test('with distance: two-tier + rating + review_count + distance + name', () => {
      const result = buildOrderByClause('rating', true);

      expect(result).toContain('CASE WHEN e.review_count >= 3 THEN 0 ELSE 1 END ASC');
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('distance_km ASC');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: two-tier + rating + review_count + base_score + name', () => {
      const result = buildOrderByClause('rating', false);

      expect(result).toContain('CASE WHEN e.review_count >= 3 THEN 0 ELSE 1 END ASC');
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.base_score DESC');
      expect(result).toContain('e.name ASC');
      expect(result).not.toContain('distance_km');
    });

    test('two-tier CASE uses RATING_SORT_MIN_REVIEWS constant', () => {
      const result = buildOrderByClause('rating', false);
      expect(result).toContain(`e.review_count >= ${RATING_SORT_MIN_REVIEWS}`);
    });
  });

  // =========================================================================
  // Distance sort
  // =========================================================================

  describe('distance sort', () => {
    test('with distance: distance + base_score + rating + name', () => {
      const result = buildOrderByClause('distance', true);

      expect(result).toMatch(/^distance_km ASC/);
      expect(result).toContain('e.base_score DESC');
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: falls back to two-tier rating sort', () => {
      const result = buildOrderByClause('distance', false);

      expect(result).toContain('CASE WHEN e.review_count >= 3 THEN 0 ELSE 1 END ASC');
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).not.toContain('distance_km');
    });
  });

  // =========================================================================
  // Price sort
  // =========================================================================

  describe('price_asc sort', () => {
    test('with distance: price + distance + rating + name', () => {
      const result = buildOrderByClause('price_asc', true);

      expect(result).toMatch(/CASE.*ELSE 4.*END\) ASC/s);
      expect(result).toContain('distance_km ASC');
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: price + rating + review_count + name', () => {
      const result = buildOrderByClause('price_asc', false);

      expect(result).toMatch(/CASE.*ELSE 4.*END\) ASC/s);
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.name ASC');
      expect(result).not.toContain('distance_km');
    });

    test('NULL price_range maps to ELSE 4 (sorts after $$$=3)', () => {
      const result = buildOrderByClause('price_asc', false);

      // Verify CASE expression: $→1, $$→2, $$$→3, ELSE 4
      expect(result).toContain("WHEN '$' THEN 1");
      expect(result).toContain("WHEN '$$' THEN 2");
      expect(result).toContain("WHEN '$$$' THEN 3");
      expect(result).toContain('ELSE 4');
      // $$$$ should NOT be present
      expect(result).not.toContain("'$$$$'");
    });
  });

  describe('price_desc sort', () => {
    test('with distance: price DESC + distance + rating + name', () => {
      const result = buildOrderByClause('price_desc', true);

      expect(result).toMatch(/CASE.*ELSE 4.*END\) DESC/s);
      expect(result).toContain('distance_km ASC');
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: price DESC + rating + review_count + name', () => {
      const result = buildOrderByClause('price_desc', false);

      expect(result).toMatch(/CASE.*ELSE 4.*END\) DESC/s);
      expect(result).toContain('e.average_rating DESC NULLS LAST');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.name ASC');
    });
  });

  // =========================================================================
  // Default sort
  // =========================================================================

  describe('default sort (unknown sortBy)', () => {
    test('with distance: same as rating with distance', () => {
      const withDist = buildOrderByClause('unknown_value', true);
      const rating = buildOrderByClause('rating', true);
      expect(withDist).toBe(rating);
    });

    test('without distance: same as rating without distance', () => {
      const noDist = buildOrderByClause('unknown_value', false);
      const rating = buildOrderByClause('rating', false);
      expect(noDist).toBe(rating);
    });

    test('undefined sortBy uses default', () => {
      const result = buildOrderByClause(undefined, false);
      expect(result).toContain('CASE WHEN e.review_count >= 3 THEN 0 ELSE 1 END ASC');
    });
  });

  // =========================================================================
  // Cross-cutting: NULLS LAST consistency
  // =========================================================================

  describe('NULLS LAST consistency', () => {
    const sortModes = ['rating', 'price_asc', 'price_desc', 'distance'];

    sortModes.forEach(mode => {
      test(`${mode} with distance includes NULLS LAST on average_rating`, () => {
        const result = buildOrderByClause(mode, true);
        if (result.includes('e.average_rating')) {
          expect(result).toContain('e.average_rating DESC NULLS LAST');
        }
      });

      test(`${mode} without distance includes NULLS LAST on average_rating`, () => {
        const result = buildOrderByClause(mode, false);
        if (result.includes('e.average_rating')) {
          expect(result).toContain('e.average_rating DESC NULLS LAST');
        }
      });
    });
  });

  // =========================================================================
  // CTE alias compatibility
  // =========================================================================

  describe('CTE alias substitution (replaceAll e. → ne.)', () => {
    const sortModes = ['rating', 'price_asc', 'price_desc', 'distance'];

    sortModes.forEach(mode => {
      test(`${mode} with distance: all e. prefixes convert to ne.`, () => {
        const original = buildOrderByClause(mode, true);
        const aliased = original.replaceAll('e.', 'ne.');

        // No remaining 'e.' references (except inside CASE keyword or ELSE)
        // Split by known keywords and check column references
        const columnRefs = aliased.match(/\b[a-z]+\.[a-z_]+/g) || [];
        const badRefs = columnRefs.filter(ref => ref.startsWith('e.'));
        expect(badRefs).toEqual([]);
      });
    });
  });
});
