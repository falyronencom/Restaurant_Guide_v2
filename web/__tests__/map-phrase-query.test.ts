import { buildFilters, markersQuery } from '@/components/map/MapView';

/*
 * The results map's request (MapView → /api/map) under a search phrase.
 *
 * Without a phrase the query must stay exactly what the bounds backend has
 * always received — no city (the box implies it), no amenities (that backend
 * has no such facet). With a phrase the route handler answers from the smart
 * endpoint, which needs the city and honours the amenities the list is
 * filtered by — so both ride along, and only then.
 */

const BOX = { swLat: 53.8, neLat: 54, swLon: 27.4, neLon: 27.7 };

describe('MapView request — buildFilters + markersQuery', () => {
  it('without a phrase: the classic bounds query, no city, no amenities', () => {
    const filters = buildFilters('minsk', 'cafes', {
      cuisine: 'italian',
      features: 'terrace,wifi',
    });

    expect(markersQuery(BOX, filters)).toBe(
      'swLat=53.8&neLat=54&swLon=27.4&neLon=27.7&limit=500&category=cafes&cuisines=italian',
    );
  });

  it('with a phrase: the phrase, the city and the list’s amenities ride along', () => {
    const filters = buildFilters('minsk', undefined, {
      search: 'терраса',
      features: 'terrace,wifi',
    });

    const qs = new URLSearchParams(markersQuery(BOX, filters));
    expect(qs.get('search')).toBe('терраса');
    expect(qs.get('city')).toBe('minsk');
    expect(qs.get('features')).toBe('terrace,wifi');
  });
});
