/**
 * EstablishmentCard (search results) — how the title treats a long word
 * (сверка находок тестировщика с сайтом, 18.10, п. 5; доработка по Trunk).
 *
 * Measured live at 360 and 375 px: without the rating badge the title column
 * is ≈112–119px, every ordinary word fits, and only a word longer than the
 * line must wrap instead of being cut off at the card's edge. Next to the
 * badge the column is ≈70–77px — narrower than an ordinary word («Обычное»
 * ≈95px) — so allowing in-word breaks there split ordinary words mid-word
 * («Обычн/ое»). That case stays exactly as before the PR: a design question
 * (font size or badge placement), not settled here.
 *
 * A class contract: the break itself is the browser's.
 */
import { render, screen } from '@testing-library/react';

jest.mock('@/components/favorites/FavoriteButton', () => ({
  FavoriteButton: () => null,
}));
jest.mock('@/components/catalog/OpenStatusBadge', () => ({
  OpenStatusBadge: () => null,
}));

import { EstablishmentCard } from '@/components/catalog/EstablishmentCard';
import type { PublicEstablishmentListing } from '@/lib/api/types';

function card(name: string, reviews: { review_count: number; average_rating: number }) {
  return {
    id: 'e1',
    slug: 'kafe-1',
    name,
    city_slug: 'minsk',
    category_slug: 'cafes',
    address: 'ул. Тестовая, 1',
    categories: [],
    cuisines: [],
    price_range: null,
    working_hours: null,
    status: 'active',
    primary_image_url: null,
    has_promotion: false,
    ...reviews,
  } as unknown as PublicEstablishmentListing;
}

const renderCard = (e: PublicEstablishmentListing) =>
  render(
    <EstablishmentCard
      establishment={e}
      fallbackCitySlug="minsk"
      fallbackCategorySlug="restaurants"
    />,
  );

it('without the badge: a word longer than the line wraps (no cut-off)', () => {
  renderCard(card('Кондитерскаяирождественская', { review_count: 0, average_rating: 0 }));

  const title = screen.getByRole('heading', { name: 'Кондитерскаяирождественская' });
  expect(title).toHaveClass('wrap-break-word');
  // break-word, not anywhere/break-all: an ordinary word that fits is never split.
  expect(title).not.toHaveClass('wrap-anywhere');
  expect(title).not.toHaveClass('break-all');
});

it('next to the badge: no in-word breaks — ordinary words are not split («Обычн/ое»)', () => {
  renderCard(card('Обычное кафе', { review_count: 2, average_rating: 4 }));

  expect(screen.getByText('4,0')).toBeInTheDocument();
  const title = screen.getByRole('heading', { name: 'Обычное кафе' });
  expect(title).not.toHaveClass('wrap-break-word');
  expect(title).not.toHaveClass('wrap-anywhere');
  expect(title).not.toHaveClass('break-all');
});

it('no reviews → no badge, no «0,0»', () => {
  renderCard(card('Обычное кафе', { review_count: 0, average_rating: 0 }));

  expect(screen.queryByText('0,0')).not.toBeInTheDocument();
});
