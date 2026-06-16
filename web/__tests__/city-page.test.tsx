/**
 * CityPage — city-wide results view (web-vitrine Segment B).
 *
 * Same async-RSC unit pattern as catalog-filters.test.tsx: mock the API-client
 * boundary (@/lib/api/endpoints/*) and invoke the async component /
 * generateMetadata AS A FUNCTION. We deliberately do NOT render the Booking
 * tree here (FilterShelf accordion + base-ui sheet + favorites need providers /
 * polyfills) — the layout is verified via live preview; these tests lock the
 * data + SEO logic that changed in Segment B:
 *   1. searchParam → getCatalog mapping — city-wide (NO category), facets parsed.
 *   2. SEO — hasAnyFilter → noindex+follow + clean /[city] canonical (CAT-C-2.3).
 *   3. Unknown city slug → notFound() before any data fetch.
 */
import { notFound } from 'next/navigation';

import CityPage, { generateMetadata } from '@/app/(public)/[city]/page';
import { getCatalog } from '@/lib/api/endpoints/establishments';
import { getMetadata, validateCitySlug } from '@/lib/api/endpoints/metadata';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

// Mock boundary: the typed API client. Bare jest.fn()s, return values set per
// test (avoids the resetMocks factory-wipe trap — feedback_jest_resetmocks).
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getCatalog: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));

const META = {
  cities: [{ slug: 'minsk', name: 'Минск' }],
  categories: [{ slug: 'restaurants', name: 'Рестораны' }],
  cuisines: [
    { slug: 'italian', name: 'Итальянская' },
    { slug: 'asian', name: 'Азиатская' },
  ],
};

const EMPTY_CATALOG = {
  establishments: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const P = () => Promise.resolve({ city: 'minsk' });
const SP = (o: Record<string, string | string[] | undefined>) =>
  Promise.resolve(o);

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (getCatalog as jest.Mock).mockResolvedValue(EMPTY_CATALOG);
});

describe('CityPage — city-wide getCatalog mapping', () => {
  it('fetches the whole city (no category) with parsed facets', async () => {
    await CityPage({
      params: P(),
      searchParams: SP({
        cuisine: 'italian,asian',
        priceRange: '$,$$',
        hours: 'until_22',
      }),
    });

    const arg = (getCatalog as jest.Mock).mock.calls[0][0];
    expect(arg.city).toBe('minsk');
    expect(arg.category).toBeUndefined();
    expect(arg.cuisines).toEqual(['italian', 'asian']);
    expect(arg.priceRange).toEqual(['$', '$$']);
    expect(arg.hours_filter).toBe('until_22');
  });

  it('passes undefined (not empty arrays) when no facets are selected', async () => {
    await CityPage({ params: P(), searchParams: SP({}) });

    const arg = (getCatalog as jest.Mock).mock.calls[0][0];
    expect(arg.cuisines).toBeUndefined();
    expect(arg.priceRange).toBeUndefined();
    expect(arg.hours_filter).toBeUndefined();
  });
});

describe('CityPage generateMetadata — filter-aware noindex + canonical', () => {
  it('noindex+follow with clean /[city] canonical when a facet is active', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ cuisine: 'italian' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe('/minsk');
  });

  it('does NOT noindex the clean city URL', async () => {
    const meta = await generateMetadata({ params: P(), searchParams: SP({}) });
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe('/minsk');
  });

  it('does NOT noindex a paginated-only URL — pages stay indexable', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ page: '2' }),
    });
    expect(meta.robots).toBeUndefined();
  });
});

describe('CityPage — invalid slug', () => {
  it('calls notFound() for an unknown city before any data fetch', async () => {
    (validateCitySlug as jest.Mock).mockResolvedValue(false);

    await expect(
      CityPage({
        params: Promise.resolve({ city: 'atlantis' }),
        searchParams: SP({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalledTimes(1);
    // Short-circuits before fetching the catalog.
    expect(getCatalog).not.toHaveBeenCalled();
  });
});
