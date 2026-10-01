/**
 * Catalog filter shelf (Phase A) — first tests for the filter surface.
 *
 * Three concerns, same async-RSC pattern as city-page.test.tsx (mock the API
 * client boundary @/lib/api/endpoints/*, invoke the async component /
 * generateMetadata as a function):
 *
 *   1. URL searchParam → getCatalog fetch-param mapping (multi-value comma-join
 *      for cuisine/priceRange, single bucket for hours, soft-ignore unknown;
 *      an unknown cuisine slug / a rating outside 1–5 dropped, not a crash).
 *   2. SEO — hasAnyFilter → noindex+follow + clean canonical (CAT-C-2.3),
 *      pagination stays indexable.
 *   3. FilterShelf island — user toggle → URL round-trip (OR-within-group
 *      comma-join, select-all short-circuit, page reset, single-select hours).
 *
 * Honesty-audit boundary (2026-09-07): `features` is absent from all three
 * concerns. The page can stop forwarding it to getCatalog (mutation M19) and the
 * shelf can collapse it when all are selected — treating an AND facet as OR
 * (M29) — with all 19 tests green. `expect.objectContaining` cannot see a
 * missing key, so concern 1 pins only the keys it names.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CategoryPage, {
  generateMetadata,
} from '@/app/(public)/[city]/[category]/page';
import {
  getCatalog,
  type CatalogParams,
} from '@/lib/api/endpoints/establishments';
import {
  getLiveCities,
  getMetadata,
  isLiveCity,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { smartSearch } from '@/lib/api/endpoints/search';
import { ApiError } from '@/lib/api/types';
import { FilterShelf } from '@/components/catalog/FilterShelf';
import { ResultsView } from '@/components/catalog/ResultsView';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

// Mock boundary: the typed API client. Bare jest.fn()s, return values set per
// test (avoids the resetMocks factory-wipe trap — see feedback_jest_resetmocks).
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
  categories: [{ slug: 'restorany', name: 'Рестораны' }],
  cuisines: [
    { slug: 'italian', name: 'Итальянская' },
    { slug: 'asian', name: 'Азиатская' },
    { slug: 'georgian', name: 'Грузинская' },
  ],
};

const EMPTY_CATALOG = {
  establishments: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const P = () => Promise.resolve({ city: 'minsk', category: 'restorany' });
const SP = (o: Record<string, string | string[] | undefined>) =>
  Promise.resolve(o);

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (getLiveCities as jest.Mock).mockResolvedValue(META.cities);
  (isLiveCity as jest.Mock).mockResolvedValue(true);
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
  (getCatalog as jest.Mock).mockResolvedValue(EMPTY_CATALOG);
});

// ===========================================================================
// 1. searchParam → getCatalog mapping
// ===========================================================================

describe('CategoryPage — searchParam → getCatalog mapping', () => {
  it('maps comma-joined multi-value cuisine/priceRange + single hours bucket', async () => {
    await CategoryPage({
      params: P(),
      searchParams: SP({
        cuisine: 'italian,asian',
        priceRange: '$,$$',
        hours: 'until_22',
      }),
    });

    expect(getCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        cuisines: ['italian', 'asian'],
        priceRange: ['$', '$$'],
        hours_filter: 'until_22',
      }),
    );
  });

  it('soft-ignores an unknown hours bucket (no 422 on the LIST surface)', async () => {
    await CategoryPage({ params: P(), searchParams: SP({ hours: 'garbage' }) });

    expect(getCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ hours_filter: undefined }),
    );
  });

  it('passes undefined (not empty arrays) when no facets are selected', async () => {
    await CategoryPage({ params: P(), searchParams: SP({}) });

    const arg = (getCatalog as jest.Mock).mock.calls[0][0];
    expect(arg.cuisines).toBeUndefined();
    expect(arg.priceRange).toBeUndefined();
    expect(arg.hours_filter).toBeUndefined();
  });

  it('a search phrase is answered by the smart endpoint, with the page’s category as a filter', async () => {
    (smartSearch as jest.Mock).mockResolvedValue({
      intent: null,
      establishments: [],
      pagination: EMPTY_CATALOG.pagination,
      fallback: false,
    });

    await CategoryPage({
      params: P(),
      searchParams: SP({ search: 'пицца', features: 'terrace' }),
    });

    expect(getCatalog).not.toHaveBeenCalled();
    expect(smartSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'пицца',
        city: 'Минск',
        categories: ['Рестораны'],
        features: ['terrace'],
      }),
    );
  });

  it('hands the phrase’s understanding and order to the results view', async () => {
    (smartSearch as jest.Mock).mockResolvedValue({
      intent: {
        category: null,
        cuisine: null,
        dish: 'пицца',
        meal_type: null,
        price_max: 20,
        location: null,
        sort: 'rating',
        tags: [],
      },
      establishments: [],
      pagination: EMPTY_CATALOG.pagination,
      fallback: false,
    });

    const ui = await CategoryPage({
      params: P(),
      searchParams: SP({ search: 'лучшая пицца до 20 рублей' }),
    });

    // The page is not rendered — find the ResultsView element in its tree.
    const find = (node: unknown): { props: Record<string, unknown> } | null => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) {
        for (const child of node) {
          const hit = find(child);
          if (hit) return hit;
        }
        return null;
      }
      const el = node as { type?: unknown; props?: Record<string, unknown> };
      if (el.type === ResultsView) return el as { props: Record<string, unknown> };
      return find(el.props?.children);
    };
    expect(find(ui)?.props).toMatchObject({
      understood: 'пицца · до 20 BYN · лучшие',
      sortFromPhrase: 'rating',
    });
  });
});

// 01.10: /minsk/restaurants?cuisine=nonexistent-xyz took the page to the error
// screen instead of the catalog — the backend's 400 on the slug.
describe('CategoryPage — a value the backend would reject is dropped, not a crash', () => {
  // The catalog answers as the backend does (publicController): 400 on a
  // cuisine slug it cannot translate (it folds case), 422 on a rating outside 1–5.
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

  it('an unknown cuisine slug: the page does not throw and fetches the category without it', async () => {
    await expect(
      CategoryPage({
        params: P(),
        searchParams: SP({ cuisine: 'nonexistent-xyz' }),
      }),
    ).resolves.toBeTruthy();

    const arg = (getCatalog as jest.Mock).mock.calls[0][0];
    expect(arg.cuisines).toBeUndefined();
  });

  it('a mixed list keeps its known slug — in the fetch and in the params ResultsView and CatalogHero pass on', async () => {
    const ui = await CategoryPage({
      params: P(),
      searchParams: SP({ cuisine: 'georgian,nonexistent-xyz', page: '2' }),
    });

    expect((getCatalog as jest.Mock).mock.calls[0][0].cuisines).toEqual([
      'georgian',
    ]);
    // ResultsView hands `searchParams` to the shelf, pagination, sort and the
    // map island (through ResultsSwitcher); the hero to its search box and the
    // mobile filter drawer.
    const narrowed = { cuisine: 'georgian', page: '2' };
    const children = (ui as { props: { children: unknown[] } }).props.children;
    const hero = children[0] as { props: Record<string, unknown> };
    const main = children[1] as { props: { children: unknown } };
    const view = main.props.children as {
      type: unknown;
      props: Record<string, unknown>;
    };
    expect(view.type).toBe(ResultsView);
    expect(view.props.searchParams).toEqual(narrowed);
    expect(view.props.selected).toMatchObject({ cuisines: ['georgian'] });
    expect(hero.props.searchParams).toEqual(narrowed);
    expect(hero.props.selected).toMatchObject({ cuisines: ['georgian'] });
  });

  it('a rating outside 1–5: the page does not throw and fetches without a rating', async () => {
    await expect(
      CategoryPage({ params: P(), searchParams: SP({ minRating: '6' }) }),
    ).resolves.toBeTruthy();

    expect((getCatalog as jest.Mock).mock.calls[0][0].minRating).toBeUndefined();
  });
});

// ===========================================================================
// 2. SEO — noindex / canonical (CAT-C-2.3)
// ===========================================================================

describe('generateMetadata — filter-aware noindex + canonical', () => {
  it('noindex+follow with clean canonical when a facet is active', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ cuisine: 'italian' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe('/minsk/restorany');
  });

  it('noindex when only the hours bucket is active', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ hours: 'until_22' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('does NOT noindex a paginated-only URL — pages stay indexable', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ page: '2' }),
    });
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe('/minsk/restorany');
  });

  it('does NOT noindex the clean catalog URL', async () => {
    const meta = await generateMetadata({ params: P(), searchParams: SP({}) });
    expect(meta.robots).toBeUndefined();
  });

  it('keeps a URL with an unknown cuisine slug noindex, canonical on the clean catalog URL', async () => {
    // The body drops the slug; the metadata reads the raw query on purpose.
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ cuisine: 'nonexistent-xyz' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe('/minsk/restorany');
  });

  it('does NOT noindex when the hours value is unknown (not a real filter)', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ hours: 'garbage' }),
    });
    expect(meta.robots).toBeUndefined();
  });
});

describe('CategoryPage — only cities with cards (Coordinator 01.10, А2)', () => {
  it('noindexes the catalog of a valid city that has no cards yet', async () => {
    (isLiveCity as jest.Mock).mockResolvedValue(false);
    const meta = await generateMetadata({
      params: Promise.resolve({ city: 'grodno', category: 'restorany' }),
      searchParams: SP({}),
    });
    expect(isLiveCity).toHaveBeenCalledWith('grodno');
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('feeds the city picker the live list, not the full metadata set', async () => {
    const LIVE = [{ slug: 'minsk', name: 'Минск' }];
    (getMetadata as jest.Mock).mockResolvedValue({
      ...META,
      cities: [...LIVE, { slug: 'grodno', name: 'Гродно' }],
    });
    (getLiveCities as jest.Mock).mockResolvedValue(LIVE);

    const tree = await CategoryPage({ params: P(), searchParams: SP({}) });
    const hero = tree.props.children[0];
    expect(hero.props.cities).toEqual(LIVE);
  });
});

// ===========================================================================
// 3. FilterShelf island — toggle → URL
// ===========================================================================

describe('FilterShelf — toggle → URL round-trip', () => {
  const baseProps = {
    citySlug: 'minsk',
    categories: [{ slug: 'restorany', name: 'Рестораны' }],
    basePath: '/minsk/restorany',
    cuisineOptions: [
      { value: 'italian', label: 'Итальянская' },
      { value: 'asian', label: 'Азиатская' },
    ],
  };

  const pushedQuery = () => {
    const url = mockPush.mock.calls[0][0] as string;
    return new URLSearchParams(url.split('?')[1] ?? '');
  };

  it('adds a price value as a comma-joined param and resets page', async () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{ page: '3' }}
        selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /до 20 руб/ }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const q = pushedQuery();
    expect(q.get('priceRange')).toBe('$');
    expect(q.get('page')).toBeNull();
  });

  it('appends a second value to the same group (OR-within-group, comma-join)', async () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{ priceRange: '$' }}
        selected={{ cuisines: [], priceRange: ['$'], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /до 50 руб/ }));

    expect(pushedQuery().get('priceRange')).toBe('$,$$');
  });

  it('omits the param when every option becomes selected (select-all short-circuit)', async () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{ priceRange: '$,$$' }}
        selected={{ cuisines: [], priceRange: ['$', '$$'], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /более 50 руб/ }));

    // All three selected → no priceRange param at all (clean URL).
    expect(mockPush.mock.calls[0][0]).toBe('/minsk/restorany');
  });

  it('single-selects an hours bucket, then clears it on re-click', async () => {
    const { rerender } = render(
      <FilterShelf
        {...baseProps}
        searchParams={{}}
        selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(pushedQuery().get('hours')).toBe('until_22');

    mockPush.mockClear();
    rerender(
      <FilterShelf
        {...baseProps}
        searchParams={{ hours: 'until_22' }}
        selected={{ cuisines: [], priceRange: [], features: [], hours: 'until_22' }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(mockPush.mock.calls[0][0]).toBe('/minsk/restorany');
  });

  it('renders a tile per cuisine option supplied from metadata', () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{}}
        selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Итальянская' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Азиатская' }),
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// 4. FilterShelf — controlled / batch mode (mobile drawer)
// ===========================================================================

describe('FilterShelf — controlled/batch mode', () => {
  const baseProps = {
    citySlug: 'minsk',
    categories: [{ slug: 'restorany', name: 'Рестораны' }],
    basePath: '/minsk/restorany',
    searchParams: {},
    cuisineOptions: [
      { value: 'italian', label: 'Итальянская' },
      { value: 'asian', label: 'Азиатская' },
    ],
  };
  const EMPTY = {
    cuisines: [],
    priceRange: [],
    features: [],
    hours: undefined,
  };

  it('toggling a cuisine calls onSelectedChange with the raw array — NO navigation', async () => {
    const onSelectedChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={EMPTY}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Итальянская' }));

    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: ['italian'] }),
    );
    expect(mockPush).not.toHaveBeenCalled(); // batch: no per-tap navigation
  });

  it('does NOT collapse when every cuisine becomes selected (raw storage, unlike live)', async () => {
    const onSelectedChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={{ ...EMPTY, cuisines: ['italian'] }}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    // Selecting the 2nd of 2 options → "all". Live mode omits the param; batch
    // mode must keep the full array (collapsing is deferred to «Применить»).
    await userEvent.click(screen.getByRole('button', { name: 'Азиатская' }));

    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: ['italian', 'asian'] }),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('re-toggling an active cuisine removes it from the draft', async () => {
    const onSelectedChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={{ ...EMPTY, cuisines: ['italian'] }}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Итальянская' }));

    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: [] }),
    );
  });

  it('renders category as a <button> that drives onCategoryChange (not a link)', async () => {
    const onCategoryChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={EMPTY}
        onSelectedChange={jest.fn()}
        onCategoryChange={onCategoryChange}
      />,
    );

    const tile = screen.getByRole('button', { name: /Рестораны/ });
    expect(tile.tagName).toBe('BUTTON'); // batch: category is NOT a SEO <Link>
    await userEvent.click(tile);
    expect(onCategoryChange).toHaveBeenCalledWith('restorany');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('re-tapping the active category clears it (→ undefined)', async () => {
    const onCategoryChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        activeCategorySlug="restorany"
        selected={EMPTY}
        onSelectedChange={jest.fn()}
        onCategoryChange={onCategoryChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Рестораны/ }));
    expect(onCategoryChange).toHaveBeenCalledWith(undefined);
  });

  it('toggles the single hours bucket in the draft, clearing on re-tap', async () => {
    const onSelectedChange = jest.fn();
    const { rerender } = render(
      <FilterShelf
        {...baseProps}
        selected={EMPTY}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 'until_22' }),
    );

    onSelectedChange.mockClear();
    rerender(
      <FilterShelf
        {...baseProps}
        selected={{ ...EMPTY, hours: 'until_22' }}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ hours: undefined }),
    );
  });
});
