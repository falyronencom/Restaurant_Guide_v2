/**
 * CityPage — city-wide results view (web-vitrine Segment B).
 *
 * Same async-RSC unit pattern as catalog-filters.test.tsx: mock the API-client
 * boundary (@/lib/api/endpoints/*) and invoke the async component /
 * generateMetadata AS A FUNCTION. We deliberately do NOT render the Booking
 * tree here (FilterShelf accordion + base-ui sheet + favorites need providers /
 * polyfills) — the layout is verified via live preview; these tests lock the
 * data + SEO logic that changed in Segment B:
 *   1. searchParam → getCatalog mapping — city-wide (NO category), facets parsed;
 *      a search phrase goes to the smart endpoint instead (lib/smart-search).
 *   2. SEO — hasAnyFilter → noindex+follow + clean /[city] canonical (CAT-C-2.3).
 *   3. Unknown city slug → notFound() before any data fetch.
 */
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import CityPage, { generateMetadata } from '@/app/(public)/[city]/page';
import { ResultsView } from '@/components/catalog/ResultsView';
import { getCatalog } from '@/lib/api/endpoints/establishments';
import {
  getLiveCities,
  getMetadata,
  isLiveCity,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { smartSearch } from '@/lib/api/endpoints/search';

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
  getLiveCities: jest.fn(),
  isLiveCity: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/search', () => ({
  smartSearch: jest.fn(),
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

const BLANK_INTENT = {
  category: null,
  cuisine: null,
  dish: null,
  meal_type: null,
  price_max: null,
  location: null,
  sort: null,
  tags: [],
};

/** The first element of `type` in an unrendered element tree (the page is not rendered here). */
function findElement(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === type) return el as ReactElement<Record<string, unknown>>;
  return findElement(el.props?.children, type);
}

const P = () => Promise.resolve({ city: 'minsk' });
const SP = (o: Record<string, string | string[] | undefined>) =>
  Promise.resolve(o);

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (getLiveCities as jest.Mock).mockResolvedValue(META.cities);
  (isLiveCity as jest.Mock).mockResolvedValue(true);
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

  it('a search phrase is answered by the smart endpoint, in the backend’s city name', async () => {
    (smartSearch as jest.Mock).mockResolvedValue({
      intent: null,
      establishments: [],
      pagination: EMPTY_CATALOG.pagination,
      fallback: false,
    });

    await CityPage({
      params: P(),
      searchParams: SP({ search: 'терраса', cuisine: 'italian' }),
    });

    expect(getCatalog).not.toHaveBeenCalled();
    expect(smartSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'терраса',
        city: 'Минск',
        cuisines: ['Итальянская'],
      }),
    );
  });

  it('hands the phrase’s understanding and order to the results view', async () => {
    (smartSearch as jest.Mock).mockResolvedValue({
      intent: { ...BLANK_INTENT, dish: 'бургер', sort: 'price_asc' },
      establishments: [],
      pagination: EMPTY_CATALOG.pagination,
      fallback: false,
    });

    const ui = await CityPage({
      params: P(),
      searchParams: SP({ search: 'бургер недорого' }),
    });

    const view = findElement(ui, ResultsView);
    expect(view?.props).toMatchObject({
      understood: 'бургер · недорого',
      sortFromPhrase: 'price_asc',
    });
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

describe('CityPage — only cities with cards (Coordinator 01.10, А2)', () => {
  it('noindexes a valid city that has no cards yet', async () => {
    (isLiveCity as jest.Mock).mockResolvedValue(false);
    const meta = await generateMetadata({
      params: Promise.resolve({ city: 'grodno' }),
      searchParams: SP({}),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('feeds the city picker the live list, not the full metadata set', async () => {
    const LIVE = [{ slug: 'minsk', name: 'Минск' }];
    (getMetadata as jest.Mock).mockResolvedValue({
      ...META,
      cities: [...LIVE, { slug: 'grodno', name: 'Гродно' }],
    });
    (getLiveCities as jest.Mock).mockResolvedValue(LIVE);

    const tree = await CityPage({ params: P(), searchParams: SP({}) });
    const hero = tree.props.children[0];
    expect(hero.props.cities).toEqual(LIVE);
  });

  it('still renders (no 404) a valid city without cards', async () => {
    (isLiveCity as jest.Mock).mockResolvedValue(false);
    await expect(
      CityPage({
        params: Promise.resolve({ city: 'grodno' }),
        searchParams: SP({}),
      }),
    ).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
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
