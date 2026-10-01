/**
 * Catalog banner city pill — the picker offers only cities with cards
 * (getLiveCities, Coordinator 01.10 А2), but a valid city without cards is
 * still reachable by a direct link (/grodno). There the pill must name the
 * city the visitor is in, not fall back to the bare «Город» (review 01.10).
 * Renders the real CatalogHero → CatalogSearch → CitySheet chain; only the
 * router is mocked.
 */
import { render, screen } from '@testing-library/react';

import { CatalogHero } from '@/components/catalog/CatalogHero';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

const LIVE = [{ slug: 'minsk', name: 'Минск' }];

function renderHero(citySlug: string, cityName: string) {
  render(
    <CatalogHero
      citySlug={citySlug}
      cityName={cityName}
      cities={LIVE}
      searchParams={{}}
      categories={[]}
      cuisineOptions={[]}
      selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      basePath={`/${citySlug}`}
    />,
  );
}

describe('CatalogHero — city pill label', () => {
  it('a city without cards (not in the live list) keeps its own name on the pill', () => {
    renderHero('grodno', 'Гродно');
    expect(screen.getByRole('button', { name: 'Гродно' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Город' })).toBeNull();
  });

  it('a live city shows its name from the list', () => {
    renderHero('minsk', 'Минск');
    expect(screen.getByRole('button', { name: 'Минск' })).toBeInTheDocument();
  });
});
