import { render, screen } from '@testing-library/react';

import { SortSelect, sortHref } from '@/components/catalog/SortSelect';

/*
 * The catalog sort select under a search phrase.
 *
 * A phrase can ask for an order («бургер недорого» → cheapest first). While
 * the visitor has not chosen one, that IS the list's order, so the select must
 * show it — and «по рейтингу» must then be sent explicitly, because an omitted
 * sort_by hands the order back to the phrase (the visitor could never get the
 * rating order). Without a phrase nothing changes: 'rating' stays the clean,
 * parameter-less default.
 */

const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

describe('sortHref — where a choice leads', () => {
  const sp = { search: 'бургер недорого', page: '3' };

  it('without a phrase order: «по рейтингу» is the clean default (no sort_by), page reset', () => {
    expect(sortHref('/minsk', { cuisine: 'italian', page: '2' }, 'rating')).toBe(
      '/minsk?cuisine=italian',
    );
    expect(sortHref('/minsk', {}, 'price_desc')).toBe('/minsk?sort_by=price_desc');
  });

  it('under a phrase that asked for «недорого», «по рейтингу» is sent explicitly', () => {
    const href = sortHref('/minsk', sp, 'rating', 'price_asc');
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(qs.get('sort_by')).toBe('rating');
    expect(qs.get('search')).toBe('бургер недорого');
    expect(qs.get('page')).toBeNull();
  });

  it('choosing the phrase’s own order leaves sort_by out (it is the order already)', () => {
    const href = sortHref('/minsk', sp, 'price_asc', 'price_asc');
    expect(new URLSearchParams(href.split('?')[1]).get('sort_by')).toBeNull();
  });
});

describe('SortSelect — what it shows', () => {
  it('shows the phrase’s order when the visitor has not chosen one', () => {
    render(
      <SortSelect
        basePath="/minsk"
        searchParams={{ search: 'бургер недорого' }}
        impliedSort="price_asc"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Сортировка' })).toHaveTextContent(
      'сначала дешевле',
    );
  });

  it('the visitor’s explicit choice wins over the phrase', () => {
    render(
      <SortSelect
        basePath="/minsk"
        searchParams={{ search: 'бургер недорого', sort_by: 'price_desc' }}
        impliedSort="price_asc"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Сортировка' })).toHaveTextContent(
      'сначала дороже',
    );
  });

  it('without a phrase order: «по рейтингу», as before', () => {
    render(<SortSelect basePath="/minsk" searchParams={{}} />);
    expect(screen.getByRole('combobox', { name: 'Сортировка' })).toHaveTextContent(
      'по рейтингу',
    );
  });
});
