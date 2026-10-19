import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ResultsView } from '@/components/catalog/ResultsView';

/*
 * The results toolbar under a search phrase — the hand-off from the page's
 * smart-search result to what the visitor sees.
 *
 *   - «Ищем: …» shows how the phrase was understood, only when there is
 *     something to show;
 *   - the sort select shows the order the phrase asked for («недорого» →
 *     «сначала дешевле»). Dropping that hand-off would also make «по рейтингу»
 *     unreachable under such a phrase (SortSelect omits sort_by for its
 *     default), so it is pinned here, one level above sort-select.test.
 *
 * The shelf and the list/map switcher are stubbed: they need providers and the
 * map island, and nothing here depends on them.
 */

jest.mock('@/components/catalog/FilterShelf', () => ({
  FilterShelf: () => null,
}));
jest.mock('@/components/catalog/ResultsSwitcher', () => ({
  ResultsSwitcher: ({
    header,
    children,
  }: {
    header?: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {header}
      {children}
    </>
  ),
}));

// Cards and the favourites island need the auth provider; the split tests
// below only read which card lands under which heading.
jest.mock('@/components/favorites/FavoritesProvider', () => ({
  FavoritesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/catalog/EstablishmentCard', () => ({
  EstablishmentCard: ({ establishment }: { establishment: { name: string } }) => (
    <article>
      <h3>{establishment.name}</h3>
    </article>
  ),
}));

const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const BASE = {
  citySlug: 'minsk',
  categories: [],
  establishments: [],
  pagination: { page: 1, limit: 20, total: 5, totalPages: 1, hasNext: false, hasPrevious: false },
  basePath: '/minsk',
  cuisineOptions: [],
  selected: { cuisines: [], priceRange: [], features: [], hours: undefined },
  fallbackCategorySlug: 'restaurants',
};

describe('ResultsView — toolbar under a search phrase', () => {
  it('shows «Ищем: …» and the phrase’s order', () => {
    render(
      <ResultsView
        {...BASE}
        searchParams={{ search: 'бургер недорого' }}
        understood="бургер · недорого"
        sortFromPhrase="price_asc"
      />,
    );

    expect(screen.getByText('Найдено 5')).toBeInTheDocument();
    expect(screen.getByText('Ищем: бургер · недорого')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Сортировка' })).toHaveTextContent(
      'сначала дешевле',
    );
  });

  it('without a phrase: no «Ищем» line, «по рейтингу» as before', () => {
    render(<ResultsView {...BASE} searchParams={{}} />);

    expect(screen.getByText('Найдено 5')).toBeInTheDocument();
    expect(screen.queryByText(/^Ищем:/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Сортировка' })).toHaveTextContent(
      'по рейтингу',
    );
  });
});

/*
 * A phrase nothing matched (Coordinator В3, 17.10.2026; сверка находок
 * тестировщика 18.10, пункты 9 и 10): «По запросу «…» ничего не найдено» and,
 * under its own heading, the suggestions — never the city as «Найдено 9».
 */
describe('ResultsView — matches vs «Возможно, вам подойдут»', () => {
  const card = (id: string, name: string) =>
    ({
      id,
      slug: id,
      name,
      description: null,
      city: 'Минск',
      city_slug: 'minsk',
      address: 'ул. Тестовая, 1',
      latitude: 53.9,
      longitude: 27.55,
      phone: null,
      website: null,
      categories: ['Кафе'],
      category_slug: 'cafes',
      cuisines: [],
      price_range: '$$',
      working_hours: null,
      attributes: {},
      status: 'active',
      primary_image_url: null,
      review_count: 0,
      average_rating: null,
      favorite_count: 0,
      booking_enabled: false,
      has_promotion: false,
    }) as unknown as (typeof BASE.establishments)[number];

  const page = (pageNo: number, limit: number, total: number) => ({
    page: pageNo,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNext: pageNo * limit < total,
    hasPrevious: pageNo > 1,
  });

  const headingOrder = () =>
    screen.getAllByRole('heading').map((h) => h.textContent);
  const cardNames = () =>
    screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  it('«Buno», nothing matched: the honest headline, then the city under «Возможно, вам подойдут»', () => {
    render(
      <ResultsView
        {...BASE}
        establishments={[card('a', 'Кофейня А'), card('b', 'Пекарня Б')]}
        pagination={page(1, 20, 2)}
        searchParams={{ search: 'Buno' }}
        matchedTotal={0}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'По запросу «Buno» ничего не найдено' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Найдено/)).not.toBeInTheDocument();
    const suggested = screen.getByRole('region', { name: 'Возможно, вам подойдут' });
    expect(suggested).toHaveTextContent('Кофейня А');
    expect(suggested).toHaveTextContent('Пекарня Б');
  });

  it('both parts on one page: the match first, then the heading, then the rest; «Найдено» counts matches only', () => {
    render(
      <ResultsView
        {...BASE}
        establishments={[card('bar', 'Бар'), card('x', 'Кофейня А'), card('y', 'Пекарня Б')]}
        pagination={page(1, 20, 3)}
        searchParams={{ search: 'бар' }}
        matchedTotal={1}
      />,
    );

    expect(screen.getByText('Найдено 1')).toBeInTheDocument();
    const order = headingOrder();
    expect(order.indexOf('Бар')).toBeLessThan(order.indexOf('Возможно, вам подойдут'));
    expect(order.indexOf('Возможно, вам подойдут')).toBeLessThan(order.indexOf('Кофейня А'));
    const suggested = screen.getByRole('region', { name: 'Возможно, вам подойдут' });
    expect(suggested).not.toHaveTextContent('Бар');
  });

  it('the boundary is an index into the whole set: page 2 of a 3-match result starts with the last match', () => {
    render(
      <ResultsView
        {...BASE}
        establishments={[card('m3', 'Совпало 3'), card('s1', 'Запасное 1')]}
        pagination={page(2, 2, 6)}
        searchParams={{ search: 'кофе' }}
        matchedTotal={3}
      />,
    );

    const order = headingOrder();
    expect(order.indexOf('Совпало 3')).toBeLessThan(order.indexOf('Возможно, вам подойдут'));
    expect(screen.getByRole('region', { name: 'Возможно, вам подойдут' })).toHaveTextContent(
      'Запасное 1',
    );
  });

  it('everything matched (or no field from the backend): one list, «Найдено N», no suggestions heading', () => {
    for (const matchedTotal of [2, null]) {
      const { unmount } = render(
        <ResultsView
          {...BASE}
          establishments={[card('a', 'Кофейня А'), card('b', 'Пекарня Б')]}
          pagination={page(1, 20, 2)}
          searchParams={{ search: 'кофейня' }}
          matchedTotal={matchedTotal}
        />,
      );
      expect(screen.getByText('Найдено 2')).toBeInTheDocument();
      expect(screen.queryByText('Возможно, вам подойдут')).not.toBeInTheDocument();
      expect(cardNames()).toEqual(['Кофейня А', 'Пекарня Б']);
      unmount();
    }
  });
});
