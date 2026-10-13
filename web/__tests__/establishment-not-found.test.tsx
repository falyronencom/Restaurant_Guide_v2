/**
 * /[city]/[category]/[slug]/not-found.tsx — what a guest sees when an
 * establishment address leads nowhere: an unknown slug, a card the backend no
 * longer shows (suspended, archived, in moderation — the same 404), or an
 * unknown city/category part of the address.
 *
 * Next renders the NEAREST not-found.tsx. Before this file the establishment
 * page and its all-reviews page fell through to [category]/not-found.tsx and
 * the guest read «Категория не найдена». Which boundary Next picks is checked
 * on the local stand (report); here — the page's own text and the way back,
 * built from the address (useParams mocked at the next/navigation boundary).
 */
import { render, screen } from '@testing-library/react';

import EstablishmentNotFound from '@/app/(public)/[city]/[category]/[slug]/not-found';

const mockUseParams = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

function renderFor(params: { city: string; category: string; slug: string }) {
  mockUseParams.mockReturnValue(params);
  render(<EstablishmentNotFound />);
}

const CLOSED = {
  city: 'minsk',
  category: 'restaurants',
  slug: 'zakrytoe-kafe',
};

describe('establishment not-found page', () => {
  it('says the establishment is missing and why it may be', () => {
    renderFor(CLOSED);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Заведение не найдено' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Возможно, оно закрылось, временно недоступно или ссылка устарела.',
      ),
    ).toBeInTheDocument();
  });

  it('leads back to the category in that city', () => {
    renderFor(CLOSED);

    expect(
      screen.getByRole('link', { name: 'Посмотреть рестораны Минска' }),
    ).toHaveAttribute('href', '/minsk/restaurants');
  });

  it('leads to the city when the category part of the address is unknown', () => {
    // The page calls notFound() for an unknown category before it asks the
    // backend for the card — the same boundary renders.
    renderFor({ city: 'gomel', category: 'zz-kategoriya', slug: 'kafe' });

    expect(
      screen.getByRole('link', { name: 'Посмотреть заведения Гомеля' }),
    ).toHaveAttribute('href', '/gomel');
  });

  it('leads home when the city part of the address is unknown', () => {
    renderFor({ city: 'zz-gorod', category: 'restaurants', slug: 'kafe' });

    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
