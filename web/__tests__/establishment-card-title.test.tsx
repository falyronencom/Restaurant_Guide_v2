/**
 * EstablishmentCard (search results) — a long word in the name wraps inside
 * the two clamped lines instead of being cut at the edge of the ≈125px phone
 * column (сверка находок тестировщика с сайтом, 18.10). A class contract: the
 * break itself is the browser's; only the classes that allow it are ours.
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

it('the title can shrink and break inside a long word', () => {
  const establishment = {
    id: 'e1',
    slug: 'kafe-1',
    name: 'Рождественскаяпекарняиконфетная',
    city_slug: 'minsk',
    category_slug: 'cafes',
    address: 'ул. Тестовая, 1',
    categories: [],
    cuisines: [],
    price_range: null,
    working_hours: null,
    status: 'active',
    primary_image_url: null,
    review_count: 0,
    average_rating: 0,
    has_promotion: false,
  } as unknown as PublicEstablishmentListing;

  render(
    <EstablishmentCard
      establishment={establishment}
      fallbackCitySlug="minsk"
      fallbackCategorySlug="restaurants"
    />,
  );

  expect(
    screen.getByRole('heading', { name: 'Рождественскаяпекарняиконфетная' }),
  ).toHaveClass('min-w-0', 'wrap-anywhere');
});
