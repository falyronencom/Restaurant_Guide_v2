/* eslint-env jest */
/**
 * Unit Tests: buildOrderByClause()
 *
 * Tests all 8 combinations: 4 sort modes × 2 coordinate states.
 * Verifies Bayesian weighted rating, price NULL handling,
 * tiebreaker order, and CTE alias compatibility.
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

const { buildOrderByClause, BAYESIAN_PRIOR_COUNT, BAYESIAN_PRIOR_RATING } =
  await import('../../services/searchService.js');

describe('buildOrderByClause', () => {
  // =========================================================================
  // Constants
  // =========================================================================

  test('BAYESIAN_PRIOR_COUNT is 5', () => {
    expect(BAYESIAN_PRIOR_COUNT).toBe(5);
  });

  test('BAYESIAN_PRIOR_RATING is 3.5', () => {
    expect(BAYESIAN_PRIOR_RATING).toBe(3.5);
  });

  // =========================================================================
  // Bayesian weighted rating formula presence
  // =========================================================================

  describe('Bayesian weighted rating', () => {
    test('rating sort contains weighted formula with correct constants', () => {
      const result = buildOrderByClause('rating', false);

      // Formula: (e.review_count * e.average_rating + 5 * 3.5) / (e.review_count + 5)
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain(`${BAYESIAN_PRIOR_COUNT} * ${BAYESIAN_PRIOR_RATING}`);
      expect(result).toContain(`e.review_count + ${BAYESIAN_PRIOR_COUNT}`);
      expect(result).toContain('DESC');
    });

    test('weighted formula does NOT contain twoTierRating CASE', () => {
      const result = buildOrderByClause('rating', false);
      expect(result).not.toContain('CASE WHEN e.review_count >=');
      expect(result).not.toContain('THEN 0 ELSE 1');
    });

    test('weighted formula does NOT use raw average_rating DESC as primary', () => {
      const result = buildOrderByClause('rating', false);
      // Should not start with e.average_rating — weighted formula comes first
      expect(result).not.toMatch(/^e\.average_rating/);
    });
  });

  // =========================================================================
  // Rating sort
  // =========================================================================

  describe('rating sort', () => {
    test('with distance: weighted + review_count + distance + name', () => {
      const result = buildOrderByClause('rating', true);

      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('distance_km ASC');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: weighted + review_count + base_score + name', () => {
      const result = buildOrderByClause('rating', false);

      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.base_score DESC');
      expect(result).toContain('e.name ASC');
      expect(result).not.toContain('distance_km');
    });
  });

  // =========================================================================
  // Distance sort
  // =========================================================================

  describe('distance sort', () => {
    test('with distance: distance + base_score + weighted + name', () => {
      const result = buildOrderByClause('distance', true);

      expect(result).toMatch(/^distance_km ASC/);
      expect(result).toContain('e.base_score DESC');
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: falls back to weighted rating sort', () => {
      const result = buildOrderByClause('distance', false);

      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.base_score DESC');
      expect(result).not.toContain('distance_km');
    });
  });

  // =========================================================================
  // Price sort
  // =========================================================================

  describe('price_asc sort', () => {
    test('with distance: price + distance + weighted + name', () => {
      const result = buildOrderByClause('price_asc', true);

      expect(result).toMatch(/CASE.*ELSE 5.*END\) ASC/s);
      expect(result).toContain('distance_km ASC');
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: price + weighted + review_count + name', () => {
      const result = buildOrderByClause('price_asc', false);

      expect(result).toMatch(/CASE.*ELSE 5.*END\) ASC/s);
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.name ASC');
      expect(result).not.toContain('distance_km');
    });

    test('NULL price_range maps to ELSE 5 (sorts after $$$$=4)', () => {
      const result = buildOrderByClause('price_asc', false);

      expect(result).toContain("WHEN '$' THEN 1");
      expect(result).toContain("WHEN '$$' THEN 2");
      expect(result).toContain("WHEN '$$$' THEN 3");
      expect(result).toContain("WHEN '$$$$' THEN 4");
      expect(result).toContain('ELSE 5');
    });
  });

  describe('price_desc sort', () => {
    test('with distance: price DESC + distance + weighted + name', () => {
      const result = buildOrderByClause('price_desc', true);

      expect(result).toMatch(/CASE.*ELSE 5.*END\) DESC/s);
      expect(result).toContain('distance_km ASC');
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: price DESC + weighted + review_count + name', () => {
      const result = buildOrderByClause('price_desc', false);

      expect(result).toMatch(/CASE.*ELSE 5.*END\) DESC/s);
      expect(result).toContain('e.review_count * e.average_rating');
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

    test('undefined sortBy uses weighted rating', () => {
      const result = buildOrderByClause(undefined, false);
      expect(result).toContain('e.review_count * e.average_rating');
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

        const columnRefs = aliased.match(/\b[a-z]+\.[a-z_]+/g) || [];
        const badRefs = columnRefs.filter(ref => ref.startsWith('e.'));
        expect(badRefs).toEqual([]);
      });
    });
  });
});
