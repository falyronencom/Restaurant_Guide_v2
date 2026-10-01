/**
 * ResultsView empty state — a guest who set NO filters must not be told
 * «Попробуйте изменить фильтры» (Coordinator 01.10, А0/А2: /grodno showed
 * exactly that). Interactive islands are stubbed — this locks only the copy.
 */
import { render, screen } from '@testing-library/react';

import { ResultsView } from '@/components/catalog/ResultsView';

jest.mock('@/components/catalog/FilterShelf', () => ({ FilterShelf: () => null }));
jest.mock('@/components/catalog/SortSelect', () => ({ SortSelect: () => null }));
jest.mock('@/components/catalog/ResultsSwitcher', () => ({
  ResultsSwitcher: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const EMPTY = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

function renderView(
  searchParams: Record<string, string>,
  activeCategorySlug?: string,
) {
  render(
    <ResultsView
      citySlug="grodno"
      categories={[]}
      activeCategorySlug={activeCategorySlug}
      establishments={[]}
      pagination={EMPTY}
      basePath="/grodno"
      searchParams={searchParams}
      cuisineOptions={[]}
      selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      fallbackCategorySlug="restaurants"
    />,
  );
}

describe('ResultsView — empty state', () => {
  it('empty city, no filters → «пока нет», no filter advice, link home', () => {
    renderView({});
    expect(screen.getByText('В этом городе пока нет заведений')).toBeInTheDocument();
    expect(screen.queryByText(/изменить фильтры/)).toBeNull();
    expect(screen.getByRole('link', { name: '← На главную' })).toHaveAttribute('href', '/');
  });

  it('sorting alone is not a filter', () => {
    renderView({ sort_by: 'rating' });
    expect(screen.queryByText(/изменить фильтры/)).toBeNull();
  });

  it('empty category, no filters → category copy, link to the city', () => {
    renderView({}, 'bowling');
    expect(screen.getByText('В этой категории пока нет заведений')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Все заведения города' })).toHaveAttribute(
      'href',
      '/grodno',
    );
  });

  it('filters set and nothing matched → keeps the filter advice', () => {
    renderView({ cuisine: 'italian' });
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
    expect(screen.getByText(/изменить фильтры/)).toBeInTheDocument();
  });
});
