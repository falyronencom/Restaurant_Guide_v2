/**
 * The city and category «не найдено» pages. The category page now leads to
 * the city of the address (CatalogBackLink, cityOnly) instead of the home
 * page — and never to the category itself, which is the page not found.
 * useParams is mocked at the next/navigation boundary.
 */
import { render, screen } from '@testing-library/react';

import CategoryNotFound from '@/app/(public)/[city]/[category]/not-found';
import CityNotFound from '@/app/(public)/[city]/not-found';

const mockUseParams = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

describe('category not-found page', () => {
  it('leads to the city of the address', () => {
    mockUseParams.mockReturnValue({ city: 'minsk', category: 'zz-kategoriya' });
    render(<CategoryNotFound />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Категория не найдена' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Посмотреть заведения Минска' }),
    ).toHaveAttribute('href', '/minsk');
  });

  it('never links to the category itself, even a known one', () => {
    mockUseParams.mockReturnValue({ city: 'minsk', category: 'restaurants' });
    render(<CategoryNotFound />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/minsk');
  });

  it('leads home when the city is unknown too', () => {
    mockUseParams.mockReturnValue({ city: 'zz-gorod', category: 'restaurants' });
    render(<CategoryNotFound />);

    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});

describe('city not-found page', () => {
  it('keeps its heading and the way home', () => {
    render(<CityNotFound />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Город не найден' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
