/**
 * catalog-params — shared search-param parsing for the results pages
 * (/[city] and /[city]/[category]). Pure functions; the SEO noindex predicate
 * (hasAnyFilter) lives here and gates both pages, so lock it directly.
 */
import {
  acceptedSearchParams,
  asFloat,
  asHours,
  asList,
  asString,
  hasAnyFilter,
  parsePage,
} from '@/lib/catalog-params';

describe('asList', () => {
  it('splits a comma-joined value, trims, drops empties', () => {
    expect(asList('italian, asian ,')).toEqual(['italian', 'asian']);
  });
  it('flattens array-form (?k=a&k=b)', () => {
    expect(asList(['a', 'b,c'])).toEqual(['a', 'b', 'c']);
  });
  it('returns [] for undefined / non-string', () => {
    expect(asList(undefined)).toEqual([]);
    expect(asList(5)).toEqual([]);
  });
});

describe('asHours', () => {
  it('passes a known bucket through', () => {
    expect(asHours('until_22')).toBe('until_22');
  });
  it('soft-ignores an unknown bucket', () => {
    expect(asHours('garbage')).toBeUndefined();
  });
});

describe('parsePage', () => {
  it('parses a positive page', () => {
    expect(parsePage('3')).toBe(3);
  });
  it('floors invalid / <1 / non-string to 1', () => {
    expect(parsePage('0')).toBe(1);
    expect(parsePage('x')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe('asString / asFloat', () => {
  it('asString: non-empty string, else undefined', () => {
    expect(asString('a')).toBe('a');
    expect(asString('')).toBeUndefined();
    expect(asString(5)).toBeUndefined();
  });
  it('asFloat: finite number, else undefined', () => {
    expect(asFloat('4.5')).toBe(4.5);
    expect(asFloat('')).toBeUndefined();
    expect(asFloat('x')).toBeUndefined();
  });
});

describe('hasAnyFilter — SEO noindex predicate (CAT-C-2.3)', () => {
  it('false for a clean URL', () => {
    expect(hasAnyFilter({})).toBe(false);
  });
  it('false for page-only — paginated URLs stay indexable', () => {
    expect(hasAnyFilter({ page: '2' })).toBe(false);
  });
  it('false for an unknown hours value (not a real filter)', () => {
    expect(hasAnyFilter({ hours: 'garbage' })).toBe(false);
  });
  it('true for each real facet/sort/search param', () => {
    expect(hasAnyFilter({ cuisine: 'italian' })).toBe(true);
    // Honesty audit 2026-09-07: the enumeration must stay complete — `features`
    // was missing, and deleting its clause from hasAnyFilter kept all 13 tests
    // green while filtered URLs went back into the index.
    expect(hasAnyFilter({ features: 'wifi' })).toBe(true);
    expect(hasAnyFilter({ priceRange: '$' })).toBe(true);
    expect(hasAnyFilter({ hours: 'until_22' })).toBe(true);
    expect(hasAnyFilter({ minRating: '4' })).toBe(true);
    expect(hasAnyFilter({ search: 'pizza' })).toBe(true);
    expect(hasAnyFilter({ sort_by: 'rating' })).toBe(true);
  });
});

// 01.10: /minsk?cuisine=nonexistent-xyz → backend 400 INVALID_SLUG, and
// ?minRating=0 → 422 — each took the whole results page to the error screen.
describe('acceptedSearchParams — values the backend would reject are dropped', () => {
  // The metadata cuisine vocabulary, as /api/v1/public/metadata returns it.
  const CUISINES = [
    { slug: 'italian', name: 'Итальянская' },
    { slug: 'asian', name: 'Азиатская' },
  ];

  it('drops an unknown cuisine slug and keeps the known ones in order', () => {
    expect(
      acceptedSearchParams(
        { cuisine: 'italian,nonexistent-xyz,asian' },
        CUISINES,
      ),
    ).toEqual({ cuisine: 'italian,asian' });
  });

  it('drops the key when no slug is known — the URL filters by no cuisine', () => {
    const accepted = acceptedSearchParams(
      { cuisine: 'nonexistent-xyz' },
      CUISINES,
    );
    expect(accepted).not.toHaveProperty('cuisine');
    expect(hasAnyFilter(accepted)).toBe(false);
  });

  it('matches a slug regardless of case (as the backend does), spelt as the metadata spells it', () => {
    expect(acceptedSearchParams({ cuisine: 'Italian' }, CUISINES)).toEqual({
      cuisine: 'italian',
    });
  });

  it('reads the array form (?cuisine=a&cuisine=b) too', () => {
    expect(
      acceptedSearchParams({ cuisine: ['asian', 'nonexistent-xyz'] }, CUISINES),
    ).toEqual({ cuisine: 'asian' });
  });

  it('drops a rating outside 1–5 and keeps the range, ends included', () => {
    expect(acceptedSearchParams({ minRating: '0' }, CUISINES)).toEqual({});
    expect(acceptedSearchParams({ minRating: '6' }, CUISINES)).toEqual({});
    for (const rating of ['1', '4.5', '5']) {
      expect(acceptedSearchParams({ minRating: rating }, CUISINES)).toEqual({
        minRating: rating,
      });
    }
  });

  it('keeps every key in its place, the narrowed ones included', () => {
    // Links built from the params keep the visitor's order.
    const accepted = acceptedSearchParams(
      {
        priceRange: '$',
        cuisine: 'nonexistent-xyz,italian',
        minRating: '4',
        search: 'x',
      },
      CUISINES,
    );
    expect(Object.keys(accepted)).toEqual([
      'priceRange',
      'cuisine',
      'minRating',
      'search',
    ]);
    expect(accepted.cuisine).toBe('italian');
  });

  it('passes every other key through untouched — values the backend soft-ignores included', () => {
    const sp = {
      priceRange: '$,$$',
      features: 'wifi,unknown-key',
      hours: 'garbage',
      search: 'пицца',
      sort_by: 'rating',
      page: '2',
      view: 'map',
      focus: 'gaijin',
    };
    expect(acceptedSearchParams(sp, CUISINES)).toEqual(sp);
  });
});
