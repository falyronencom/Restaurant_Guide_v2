/**
 * PopularCard — the home «Популярное» card (сверка находок тестировщика с
 * сайтом, 18.10).
 *
 *   1. A card without reviews shows no rating badge. Such a card carries
 *      average_rating 0 (the DB default, coerced to a number), which rendered
 *      a green «0,0». 86059f9 gated the catalog card, the detail title, the
 *      sidebar and the reviews header on review_count > 0; this card was
 *      missed.
 *   2. The address is plain text (п. 12): the whole card is one link to the
 *      venue, so an underline promised a second link that cannot exist.
 *   3. The title may break inside a long word (it is still one line with an
 *      ellipsis, not cut mid-letter).
 * The favorites and open-status islands are stubbed (they need providers).
 */
import { render, screen } from '@testing-library/react';

jest.mock('@/components/favorites/FavoriteButton', () => ({
  FavoriteButton: () => null,
}));
jest.mock('@/components/catalog/OpenStatusBadge', () => ({
  OpenStatusBadge: () => null,
}));

import { PopularCard } from '@/components/home/PopularCard';
import type { PublicEstablishmentListing } from '@/lib/api/types';

function listing(
  overrides: Partial<PublicEstablishmentListing> = {},
): PublicEstablishmentListing {
  return {
    id: 'e1',
    slug: 'kafe-1',
    name: 'Кафе у Рождественской',
    description: null,
    city: 'Минск',
    city_slug: 'minsk',
    address: 'ул. Тестовая, 1',
    latitude: null,
    longitude: null,
    phone: null,
    website: null,
    categories: ['Кафе'],
    category_slug: 'cafes',
    cuisines: [],
    price_range: null,
    working_hours: null,
    attributes: null,
    status: 'active',
    primary_image_url: null,
    review_count: 0,
    average_rating: 0,
    favorite_count: 0,
    booking_enabled: false,
    has_promotion: false,
    promotion_count: 0,
    published_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as PublicEstablishmentListing;
}

const renderCard = (e: PublicEstablishmentListing) =>
  render(
    <PopularCard
      establishment={e}
      fallbackCitySlug="minsk"
      fallbackCategorySlug="restaurants"
    />,
  );

it('no reviews (average_rating 0) → no badge, no «0,0»', () => {
  renderCard(listing({ review_count: 0, average_rating: 0 }));

  expect(screen.queryByTestId('popular-rating')).not.toBeInTheDocument();
  expect(screen.queryByText('0,0')).not.toBeInTheDocument();
});

it('with reviews → the badge shows the rating', () => {
  renderCard(listing({ review_count: 3, average_rating: 4.5 }));

  expect(screen.getByTestId('popular-rating')).toHaveTextContent('4,5');
});

it('the address is plain text, not underlined (no link inside the card link)', () => {
  renderCard(listing());

  const address = screen.getByText('ул. Тестовая, 1');
  expect(address).not.toHaveClass('underline');
  expect(address.closest('a')).not.toBeNull(); // still part of the one card link
});

it('the title may break inside a long word', () => {
  renderCard(listing());

  expect(
    screen.getByRole('heading', { name: 'Кафе у Рождественской' }),
  ).toHaveClass('wrap-anywhere');
});
