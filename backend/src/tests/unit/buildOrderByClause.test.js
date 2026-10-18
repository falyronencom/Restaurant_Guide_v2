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

/**
 * The sort keys of an ORDER BY clause, in order, by name: the clause is split
 * at its top-level commas (the weighted-rating expression has commas inside
 * parentheses), and each key is named by the column it sorts on. The titles
 * below name these sequences; toContain alone cannot see their order.
 */
const keysOf = (clause) => {
  const keys = [];
  let depth = 0;
  let current = '';
  for (const ch of clause) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      keys.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  keys.push(current.trim());
  return keys.map((key) => {
    if (key.includes('average_rating')) return 'weighted';
    if (key.startsWith('distance_km')) return 'distance';
    if (key.startsWith('e.review_count')) return 'review_count';
    if (key.startsWith('e.base_score')) return 'base_score';
    if (key.startsWith('e.name')) return 'name';
    return key;
  });
};

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

      expect(keysOf(result)).toEqual(['weighted', 'review_count', 'distance', 'name']);
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('distance_km ASC');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: weighted + review_count + base_score + name', () => {
      const result = buildOrderByClause('rating', false);

      expect(keysOf(result)).toEqual(['weighted', 'review_count', 'base_score', 'name']);
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

      expect(keysOf(result)).toEqual(['distance', 'base_score', 'weighted', 'name']);
      expect(result).toMatch(/^distance_km ASC/);
      expect(result).toContain('e.base_score DESC');
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: falls back to weighted rating sort', () => {
      const result = buildOrderByClause('distance', false);

      // The weighted rating sort, key for key: the same sequence as rating.
      expect(keysOf(result)).toEqual(['weighted', 'review_count', 'base_score', 'name']);
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

      expect(result).toMatch(/CASE.*END\) ASC NULLS LAST, distance_km ASC/s);
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: price + weighted + review_count + name', () => {
      const result = buildOrderByClause('price_asc', false);

      expect(result).toMatch(/CASE.*END\) ASC NULLS LAST, /s);
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.name ASC');
      expect(result).not.toContain('distance_km');
    });

    test('missing price_range maps to NULL, not to a placeholder number', () => {
      const result = buildOrderByClause('price_asc', false);

      expect(result).toContain("WHEN '$' THEN 1");
      expect(result).toContain("WHEN '$$' THEN 2");
      expect(result).toContain("WHEN '$$$' THEN 3");
      expect(result).toContain("WHEN '$$$$' THEN 4");
      // Any placeholder is last in one direction only: the former ELSE 5 put
      // establishments without a price FIRST under price_desc (5 > 4).
      expect(result).not.toMatch(/ELSE\s+(?!NULL\b)/);
    });
  });

  describe('price_desc sort', () => {
    test('with distance: price DESC + distance + weighted + name', () => {
      const result = buildOrderByClause('price_desc', true);

      expect(result).toMatch(/CASE.*END\) DESC NULLS LAST, distance_km ASC/s);
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.name ASC');
    });

    test('without distance: price DESC + weighted + review_count + name', () => {
      const result = buildOrderByClause('price_desc', false);

      expect(result).toMatch(/CASE.*END\) DESC NULLS LAST, /s);
      expect(result).toContain('e.review_count * e.average_rating');
      expect(result).toContain('e.review_count DESC');
      expect(result).toContain('e.name ASC');
    });
  });

  // Postgres puts NULL last under ASC but FIRST under DESC, so both price
  // directions spell NULLS LAST out. Tie-breakers after the price key are
  // the same as before the fix — literal strings, not rebuilt from the code.
  // The weighted rating carries the NULL-rating guard (scores as the prior).
  describe('price sort: no-price last in both directions, tie-breakers unchanged', () => {
    const weighted = 'COALESCE((e.review_count * e.average_rating + 5 * 3.5) / (e.review_count + 5), 3.5)';

    test.each([
      ['price_asc', true, `distance_km ASC, ${weighted} DESC, e.name ASC`],
      ['price_desc', true, `distance_km ASC, ${weighted} DESC, e.name ASC`],
      ['price_asc', false, `${weighted} DESC, e.review_count DESC, e.name ASC`],
      ['price_desc', false, `${weighted} DESC, e.review_count DESC, e.name ASC`],
    ])('%s (hasDistance=%s)', (mode, hasDistance, tieBreakers) => {
      const [priceKey, rest] = buildOrderByClause(mode, hasDistance).split(' NULLS LAST, ');

      expect(priceKey).toMatch(mode === 'price_asc' ? /END\) ASC$/ : /END\) DESC$/);
      expect(rest).toBe(tieBreakers);
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
  // NULL average_rating
  // =========================================================================

  // A NULL average_rating turns the bare formula into NULL, and Postgres puts
  // NULL FIRST under DESC: such an establishment topped the rating sort and
  // jumped ahead inside a price tier. Every mode falls back to the prior —
  // the score of an establishment without reviews.
  describe('weighted rating: NULL average_rating scores as the prior', () => {
    const guarded = 'COALESCE((e.review_count * e.average_rating + 5 * 3.5) / (e.review_count + 5), 3.5) DESC';

    test.each([
      ['rating', true], ['rating', false],
      ['price_asc', true], ['price_asc', false],
      ['price_desc', true], ['price_desc', false],
      ['distance', true], ['distance', false],
      [undefined, true], [undefined, false],
    ])('%s (hasDistance=%s)', (mode, hasDistance) => {
      expect(buildOrderByClause(mode, hasDistance)).toContain(guarded);
    });
  });

  // =========================================================================
  // CTE alias compatibility
  // =========================================================================

  describe('CTE alias substitution (replaceAll e. → ne.)', () => {
    const sortModes = ['rating', 'price_asc', 'price_desc', 'distance'];

    sortModes.forEach(mode => {
      // searchService turns every «e.» into «ne.» for the CTE of the radius
      // search; that is enough only if every column the clause names is
      // «e.»-prefixed. After the replace no ref can start with «e.» any more,
      // so a check on the replaced text passes whatever the clause says: the
      // check runs on the original.
      test(`${mode} with distance: every column ref is e.-prefixed, so all convert to ne.`, () => {
        const original = buildOrderByClause(mode, true);

        const columnRefs = original.match(/\b[a-z_]+\.[a-z_]+/g) || [];
        expect(columnRefs.length).toBeGreaterThan(0);
        expect(columnRefs.filter((ref) => !ref.startsWith('e.'))).toEqual([]);
      });
    });
  });
});
