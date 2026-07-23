/**
 * buildResultsHref — the mobile filter drawer's «Применить» URL contract.
 *
 * This is the crux of the batch model: one navigation must reproduce EXACTLY
 * what the live desktop shelf produces incrementally (FilterShelf.navigate +
 * HeroSearch.onSubmit). Category → path segment; OR-within facets omit-when-all;
 * features keep-when-all; hours single; `page` dropped; every other sibling
 * (search / sort_by / minRating / view …) carried through untouched.
 */
import { buildResultsHref } from '@/lib/catalog-href';

// Full cuisine vocabulary used across the omit-when-all cases (3 options).
const CUISINE_COUNT = 3;
const EMPTY = {
  cuisines: [] as string[],
  priceRange: [] as string[],
  features: [] as string[],
  hours: undefined as string | undefined,
};

// Parse helper: split path vs query so each concern is asserted independently.
const parse = (href: string) => {
  const [path, qs] = href.split('?');
  return { path, params: new URLSearchParams(qs ?? '') };
};

describe('buildResultsHref — path (category = route segment)', () => {
  it('no category → /{city}', () => {
    const { path } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: EMPTY,
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(path).toBe('/minsk');
  });

  it('category chosen → /{city}/{category}', () => {
    const { path } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: 'restorany',
        selected: EMPTY,
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(path).toBe('/minsk/restorany');
  });

  it('clean selection → no query string at all', () => {
    expect(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: 'restorany',
        selected: EMPTY,
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    ).toBe('/minsk/restorany');
  });
});

describe('buildResultsHref — OR-within facets (cuisine / priceRange)', () => {
  it('comma-joins a subset of cuisines', () => {
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, cuisines: ['italian', 'asian'] },
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.get('cuisine')).toBe('italian,asian');
  });

  it('omits cuisine when ALL are selected (== no constraint)', () => {
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, cuisines: ['italian', 'asian', 'georgian'] },
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.has('cuisine')).toBe(false);
  });

  it('comma-joins a subset of priceRange', () => {
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, priceRange: ['$', '$$'] },
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.get('priceRange')).toBe('$,$$');
  });

  it('omits priceRange when ALL three buckets are selected', () => {
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, priceRange: ['$', '$$', '$$$'] },
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.has('priceRange')).toBe(false);
  });
});

describe('buildResultsHref — AND-between features + single hours', () => {
  it('comma-joins a subset of features', () => {
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, features: ['wifi', 'parking'] },
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.get('features')).toBe('wifi,parking');
  });

  it('KEEPS features even when all are selected (AND — "all" is a real filter)', () => {
    const all = ['delivery', 'wifi', 'terrace'];
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, features: all },
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.get('features')).toBe('delivery,wifi,terrace');
  });

  it('sets a single hours bucket', () => {
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, hours: 'until_22' },
        searchParams: {},
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.get('hours')).toBe('until_22');
  });
});

describe('buildResultsHref — sibling preservation + page reset', () => {
  it('drops `page` and preserves search / sort_by / minRating / view', () => {
    const { path, params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: 'restorany',
        selected: { ...EMPTY, cuisines: ['italian'] },
        searchParams: {
          page: '4',
          search: 'паста',
          sort_by: 'price_asc',
          minRating: '4',
          view: 'map',
        },
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(path).toBe('/minsk/restorany');
    expect(params.has('page')).toBe(false);
    expect(params.get('search')).toBe('паста');
    expect(params.get('sort_by')).toBe('price_asc');
    expect(params.get('minRating')).toBe('4');
    expect(params.get('view')).toBe('map');
    expect(params.get('cuisine')).toBe('italian');
  });

  it('rebuilds facet params from the draft, ignoring stale ones in the URL', () => {
    // The incoming URL still carries the OLD facets; the draft is the truth.
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: { ...EMPTY, priceRange: ['$'] },
        searchParams: {
          cuisine: 'georgian',
          priceRange: '$$,$$$',
          features: 'wifi',
          hours: '24_hours',
        },
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.has('cuisine')).toBe(false); // draft has none
    expect(params.get('priceRange')).toBe('$'); // draft overrides
    expect(params.has('features')).toBe(false); // draft has none
    expect(params.has('hours')).toBe(false); // draft has none
  });

  it('preserves a repeated (array) sibling param', () => {
    const { params } = parse(
      buildResultsHref({
        citySlug: 'minsk',
        categorySlug: undefined,
        selected: EMPTY,
        searchParams: { tag: ['a', 'b'] },
        cuisineCount: CUISINE_COUNT,
      }),
    );
    expect(params.getAll('tag')).toEqual(['a', 'b']);
  });
});
