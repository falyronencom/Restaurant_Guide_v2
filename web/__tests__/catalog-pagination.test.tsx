/**
 * CatalogPagination — sync prop-taking component (no top-level await), so it
 * renders directly under React Testing Library (no async-RSC workaround).
 *
 * Shape contract under test (see the component's buildHref + auto-hide):
 *   1. totalPages <= 1 => renders nothing (auto-hide).
 *   2. prev/next hrefs = basePath + preserved searchParams with `page` replaced
 *      (page 1 dropped to keep the canonical URL clean), built both WITH and
 *      WITHOUT an incoming `page` param in searchParams.
 *   3. Other searchParams (e.g. cuisine) are preserved verbatim in generated
 *      hrefs; `page` is the only param the builder replaces.
 *
 * next/link renders to an <a href> in jsdom, so hrefs are asserted by reading
 * the rendered anchors. Query strings are compared via URLSearchParams to stay
 * order-independent.
 */
import { render, screen } from '@testing-library/react';

import { CatalogPagination } from '@/components/catalog/CatalogPagination';

const hrefOf = (name: string) =>
  (screen.getByRole('link', { name }).getAttribute('href') ?? '') as string;

const queryOf = (href: string) =>
  new URLSearchParams(href.split('?')[1] ?? '');

describe('CatalogPagination — auto-hide', () => {
  it('renders nothing when totalPages <= 1', () => {
    const { container } = render(
      <CatalogPagination
        currentPage={1}
        totalPages={1}
        basePath='/minsk/restorany'
        searchParams={{}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders the nav when totalPages > 1', () => {
    render(
      <CatalogPagination
        currentPage={2}
        totalPages={5}
        basePath='/minsk/restorany'
        searchParams={{}}
      />,
    );

    expect(
      screen.getByRole('navigation', { name: 'Постраничная навигация' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Страница 2 из 5')).toBeInTheDocument();
  });
});

describe('CatalogPagination — href build (page replaced)', () => {
  it('builds prev/next hrefs WITHOUT an incoming page param (page 1 drops the param)', () => {
    render(
      <CatalogPagination
        currentPage={2}
        totalPages={5}
        basePath='/minsk/restorany'
        searchParams={{}}
      />,
    );

    // prev -> page 1 => canonical URL with no ?page=
    expect(hrefOf('Назад')).toBe('/minsk/restorany');
    // next -> page 3 => ?page=3
    expect(queryOf(hrefOf('Вперёд')).get('page')).toBe('3');
  });

  it('builds prev/next hrefs WITH an incoming page param — resulting page value is single and correct', () => {
    render(
      <CatalogPagination
        currentPage={3}
        totalPages={5}
        basePath='/minsk/restorany'
        searchParams={{ page: '3' }}
      />,
    );

    const prevQ = queryOf(hrefOf('Назад'));
    const nextQ = queryOf(hrefOf('Вперёд'));

    // Observable contract: exactly one page param, set to currentPage-1 / +1
    // (params.set dedupes the incoming page; this asserts that single result).
    expect(prevQ.getAll('page')).toEqual(['2']);
    expect(nextQ.getAll('page')).toEqual(['4']);
  });
});

describe('CatalogPagination — reuse contract (preserve other params)', () => {
  it('preserves a single-value searchParam (cuisine) in both hrefs; only page is replaced', () => {
    render(
      <CatalogPagination
        currentPage={3}
        totalPages={5}
        basePath='/minsk/restorany'
        searchParams={{ cuisine: 'italian', page: '3' }}
      />,
    );

    const prevQ = queryOf(hrefOf('Назад'));
    const nextQ = queryOf(hrefOf('Вперёд'));

    expect(prevQ.get('cuisine')).toBe('italian');
    expect(prevQ.get('page')).toBe('2');

    expect(nextQ.get('cuisine')).toBe('italian');
    expect(nextQ.get('page')).toBe('4');
  });

  it('preserves a multi-value (array) searchParam across the rebuilt hrefs', () => {
    render(
      <CatalogPagination
        currentPage={2}
        totalPages={5}
        basePath='/minsk/restorany'
        searchParams={{ cuisine: ['italian', 'asian'] }}
      />,
    );

    // prev -> page 1: page param dropped, but array param fully preserved.
    const prevQ = queryOf(hrefOf('Назад'));
    expect(prevQ.getAll('cuisine')).toEqual(['italian', 'asian']);
    expect(prevQ.has('page')).toBe(false);

    // next -> page 3: array preserved + page set.
    const nextQ = queryOf(hrefOf('Вперёд'));
    expect(nextQ.getAll('cuisine')).toEqual(['italian', 'asian']);
    expect(nextQ.get('page')).toBe('3');
  });

  it('drops nullish searchParam values rather than emitting empty params', () => {
    render(
      <CatalogPagination
        currentPage={2}
        totalPages={5}
        basePath='/minsk/restorany'
        searchParams={{ cuisine: 'italian', hours: undefined }}
      />,
    );

    const nextQ = queryOf(hrefOf('Вперёд'));
    expect(nextQ.has('hours')).toBe(false);
    expect(nextQ.get('cuisine')).toBe('italian');
  });
});
