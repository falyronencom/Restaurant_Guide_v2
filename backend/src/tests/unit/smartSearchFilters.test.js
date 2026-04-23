/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: smartSearchService.buildSmartSearchFilters
 *
 * Segment B introduces `dish` and routes `price_max` based on its presence:
 *   - With dish:    price_max → priceMaxByn (literal BYN on menu_items.price_byn)
 *   - Without dish: price_max → priceRange (legacy subjective tier mapping)
 */

import { buildSmartSearchFilters } from '../../services/smartSearchService.js';

describe('buildSmartSearchFilters — dish routing', () => {
  test('sets filters.dish when intent.dish is non-empty', () => {
    const intent = {
      dish: 'кофе',
      category: null,
      cuisine: null,
      price_max: null,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBe('кофе');
    expect(filters.priceRange).toBeUndefined();
    expect(filters.priceMaxByn).toBeUndefined();
  });

  test('does NOT set filters.dish when intent.dish is null', () => {
    const intent = {
      dish: null,
      category: 'Кофейня',
      cuisine: null,
      price_max: null,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBeUndefined();
    expect(filters.categories).toEqual(['Кофейня']);
  });
});

describe('buildSmartSearchFilters — price routing with/without dish', () => {
  test('price_max routes to priceMaxByn when dish is set', () => {
    const intent = {
      dish: 'бургер',
      category: null,
      cuisine: null,
      price_max: 10,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.priceMaxByn).toBe(10);
    expect(filters.priceRange).toBeUndefined();
  });

  test('price_max routes to priceRange when dish is NOT set (legacy)', () => {
    const intent = {
      dish: null,
      category: 'Кофейня',
      cuisine: null,
      price_max: 12,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.priceMaxByn).toBeUndefined();
    expect(filters.priceRange).toEqual(['$']);
  });

  test('price_max=25 maps to ["$", "$$"] without dish', () => {
    const intent = {
      dish: null,
      category: null,
      cuisine: null,
      price_max: 25,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    expect(buildSmartSearchFilters(intent).priceRange).toEqual(['$', '$$']);
  });

  test('price_max=100 maps to ["$", "$$", "$$$"] without dish', () => {
    const intent = {
      dish: null,
      category: null,
      cuisine: null,
      price_max: 100,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    expect(buildSmartSearchFilters(intent).priceRange).toEqual(['$', '$$', '$$$']);
  });

  test('dish + price_max together: both filters set correctly', () => {
    const intent = {
      dish: 'кофе',
      category: null,
      cuisine: null,
      price_max: 5,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBe('кофе');
    expect(filters.priceMaxByn).toBe(5);
    expect(filters.priceRange).toBeUndefined();
  });
});
