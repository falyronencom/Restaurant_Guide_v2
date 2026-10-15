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
 *   4. A facet value the backend would reject (an unknown cuisine slug, a rating
 *      outside 1–5) is dropped before the fetch and before the params are
 *      handed on (ResultsView → shelf, links, map island; CatalogHero) — the
 *      page does not throw, so the error screen does not show (01.10).
 */
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import CityPage, { generateMetadata } from '@/app/(public)/[city]/page';
import { ResultsView } from '@/components/catalog/ResultsView';
import {
  getCatalog,
  type CatalogParams,
} from '@/lib/api/endpoints/establishments';
import {
  getLiveCities,
  getMetadata,
  isLiveCity,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { smartSearch } from '@/lib/api/endpoints/search';
import { ApiError } from '@/lib/api/types';

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

describe('CityPage — a value the backend would reject is dropped, not a crash', () => {
  // The catalog answers as the backend does (publicController): 400 on a
  // cuisine slug it cannot translate (it folds case), 422 on a rating outside
  // 1–5. Before 01.10 either took the page to the error screen.
  beforeEach(() => {
    const known = META.cuisines.map((c) => c.slug);
    (getCatalog as jest.Mock).mockImplementation(async (p: CatalogParams) => {
      if (p.cuisines?.some((c) => !known.includes(c.toLowerCase()))) {
        throw new ApiError(400, 'Invalid cuisine slug', 'INVALID_SLUG');
      }
      if (p.minRating !== undefined && (p.minRating < 1 || p.minRating > 5)) {
        throw new ApiError(422, 'minRating must be between 1 and 5', 'VALIDATION_ERROR');
      }
      return EMPTY_CATALOG;
    });
  });

  it('an unknown cuisine slug: the page does not throw and fetches the whole city', async () => {
    await expect(
      CityPage({ params: P(), searchParams: SP({ cuisine: 'nonexistent-xyz' }) }),
    ).resolves.toBeTruthy();

    const arg = (getCatalog as jest.Mock).mock.calls[0][0];
    expect(arg.cuisines).toBeUndefined();
  });

  it('a mixed list keeps its known slug — in the fetch and in the params ResultsView and CatalogHero pass on', async () => {
    const ui = await CityPage({
      params: P(),
      searchParams: SP({ cuisine: 'italian,nonexistent-xyz', view: 'map' }),
    });

    expect((getCatalog as jest.Mock).mock.calls[0][0].cuisines).toEqual([
      'italian',
    ]);
    // ResultsView hands `searchParams` to the shelf, pagination, sort and —
    // through ResultsSwitcher — the map island, which builds its /api/map
    // query from them (MapView buildFilters); the hero to its search box and
    // the mobile filter drawer.
    const narrowed = { cuisine: 'italian', view: 'map' };
    const view = findElement(ui, ResultsView);
    expect(view?.props.searchParams).toEqual(narrowed);
    expect(view?.props.selected).toMatchObject({ cuisines: ['italian'] });
    const hero = (ui as ReactElement<{ children: ReactElement[] }>).props
      .children[0] as ReactElement<Record<string, unknown>>;
    expect(hero.props.searchParams).toEqual(narrowed);
    expect(hero.props.selected).toMatchObject({ cuisines: ['italian'] });
  });

  it('a rating outside 1–5: the page does not throw and fetches without a rating', async () => {
    await expect(
      CityPage({ params: P(), searchParams: SP({ minRating: '0' }) }),
    ).resolves.toBeTruthy();

    expect((getCatalog as jest.Mock).mock.calls[0][0].minRating).toBeUndefined();
  });

  it('a phrase with an unknown cuisine slug still takes the smart path', async () => {
    (smartSearch as jest.Mock).mockResolvedValue({
      intent: null,
      establishments: [],
      pagination: EMPTY_CATALOG.pagination,
      fallback: false,
    });

    await CityPage({
      params: P(),
      searchParams: SP({ search: 'терраса', cuisine: 'italian,nonexistent-xyz' }),
    });

    expect(getCatalog).not.toHaveBeenCalled();
    expect(smartSearch).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: ['Итальянская'] }),
    );
  });
});

// 12.10: /minsk?page=100000000000000000000, /minsk?priceRange=%00 and
// /minsk?search=%00 took the page to the error screen.
describe('CityPage — a huge page number or a control character is not a crash', () => {
  const NUL = String.fromCharCode(0);
  // The catalog answers as the backend does, measured on a local stand (12.10):
  // NUL in a text value is a 500 (the database cannot hold it in text); an
  // OFFSET, (page − 1) × 20, past the database's bigint is a 500 or a 400.
  beforeEach(() => {
    (getCatalog as jest.Mock).mockImplementation(async (p: CatalogParams) => {
      if ([...(p.priceRange ?? []), p.search ?? ''].some((t) => t.includes(NUL))) {
        throw new ApiError(500, 'invalid byte sequence for encoding "UTF8": 0x00', '22021');
      }
      if (((p.page ?? 1) - 1) * 20 > 2 ** 63) {
        throw new ApiError(500, 'value is out of range for type bigint', '22003');
      }
      return EMPTY_CATALOG;
    });
  });

  it('a page number past any listing: the page does not throw and fetches page 1', async () => {
    await expect(
      CityPage({ params: P(), searchParams: SP({ page: '100000000000000000000' }) }),
    ).resolves.toBeTruthy();

    expect((getCatalog as jest.Mock).mock.calls[0][0].page).toBe(1);
  });

  it('NUL as a price: fetched without it, and the params handed on carry none', async () => {
    const ui = await CityPage({
      params: P(),
      searchParams: SP({ priceRange: NUL, view: 'map' }),
    });

    expect((getCatalog as jest.Mock).mock.calls[0][0].priceRange).toBeUndefined();
    expect(findElement(ui, ResultsView)?.props.searchParams).toEqual({ view: 'map' });
  });

  it('NUL as the phrase: no phrase is left, the catalog answers', async () => {
    await expect(
      CityPage({ params: P(), searchParams: SP({ search: NUL }) }),
    ).resolves.toBeTruthy();

    expect(smartSearch).not.toHaveBeenCalled();
    expect((getCatalog as jest.Mock).mock.calls[0][0].search).toBeUndefined();
  });

  it('NUL inside a phrase: when the smart endpoint fails, the fallback searches the same words', async () => {
    // The fallback logs a warning (lib/smart-search logFallback) — kept quiet.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (smartSearch as jest.Mock).mockRejectedValueOnce(
      new ApiError(429, 'Rate limit exceeded'),
    );

    try {
      await expect(
        CityPage({ params: P(), searchParams: SP({ search: `терраса${NUL}` }) }),
      ).resolves.toBeTruthy();

      expect(smartSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'терраса' }),
      );
      expect((getCatalog as jest.Mock).mock.calls[0][0].search).toBe('терраса');
    } finally {
      warn.mockRestore();
    }
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

  it('keeps a URL with an unknown cuisine slug noindex, canonical on the clean city', async () => {
    // The body drops the slug; the metadata reads the raw query on purpose.
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ cuisine: 'nonexistent-xyz' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe('/minsk');
  });

  it('an unknown city: the tab says «Город не найден», not «Заведения <slug>»', async () => {
    (validateCitySlug as jest.Mock).mockResolvedValue(false);
    const meta = await generateMetadata({
      params: Promise.resolve({ city: 'zz-gorod' }),
      searchParams: SP({}),
    });
    expect(meta.title).toBe('Город не найден');
  });

  it('a known city keeps its heading as the title', async () => {
    const meta = await generateMetadata({ params: P(), searchParams: SP({}) });
    expect(meta.title).toBe('Заведения Минска');
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
