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
  ResultsSwitcher: ({ children }: { children: ReactNode }) => <>{children}</>,
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
