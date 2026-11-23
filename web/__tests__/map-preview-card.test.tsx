/**
 * MapPreviewCard — the ✕ of the map's tap-to-preview card is «Закрыть
 * карточку» to a screen reader. On the establishment page the card sits
 * inside the map dialog, whose own X is «Закрыть» (ui/dialog) and closes the
 * whole map: two buttons of one name would not tell which is which.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MapPreviewCard } from '@/components/map/MapPreviewCard';
import type { PublicEstablishmentMapMarker } from '@/lib/api/types';

const MARKER: PublicEstablishmentMapMarker = {
  id: 'est-1',
  slug: 'testovoe',
  name: 'Тестовое заведение',
  city: 'Минск',
  city_slug: 'minsk',
  address: 'ул. Тестовая, 1',
  categories: ['Ресторан'],
  category_slug: 'restorany',
  price_range: null,
  latitude: 53.9,
  longitude: 27.56,
  primary_image_url: null,
  review_count: 0,
  average_rating: null,
  has_promotion: false,
};

it('the ✕ is «Закрыть карточку» — not the map dialog\'s «Закрыть» — and closes the card', async () => {
  const onClose = jest.fn();
  render(
    <MapPreviewCard
      marker={MARKER}
      fallbackCitySlug='minsk'
      fallbackCategorySlug='restorany'
      onClose={onClose}
    />,
  );

  expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть карточку' }));

  expect(onClose).toHaveBeenCalledTimes(1);
});
