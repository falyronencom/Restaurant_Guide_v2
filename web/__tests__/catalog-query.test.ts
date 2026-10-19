/**
 * @jest-environment node
 *
 * The catalog request on the wire (lib/api/endpoints/establishments → getCatalog).
 *
 * Every importer of the endpoints module mocks it whole — the pages, the map
 * route, the smart-search fallback — so how the params become a query string
 * was seen by no test: a list joined with anything but a comma arrives as one
 * value the backend does not know, and a facet sent under another name is not
 * read at all — every suite green either way. The expectation comes from the
 * other side: publicController.listPublicEstablishments reads these names and
 * splits a list param on commas (parseListParam; repeated keys work too);
 * empty values are not sent.
 */
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { serverFetch } from '@/lib/api/client';
import { getCatalog } from '@/lib/api/endpoints/establishments';

const mockServerFetch = serverFetch as jest.Mock;

beforeEach(() => {
  mockServerFetch.mockReset();
  mockServerFetch.mockResolvedValue({ establishments: [], pagination: {} });
});

function sentQuery(): URL {
  return new URL(mockServerFetch.mock.calls[0][0] as string, 'http://backend.invalid');
}

describe('getCatalog — the query the backend reads', () => {
  it('lists go comma-joined under the names publicController reads', async () => {
    await getCatalog({
      city: 'minsk',
      cuisines: ['italian', 'asian'],
      priceRange: ['$', '$$'],
      features: ['terrace', 'wifi'],
      minRating: 4,
      hours_filter: 'until_22',
      sort_by: 'rating',
      page: 2,
    });

    const url = sentQuery();
    expect(url.pathname).toBe('/api/v1/public/establishments');
    expect(url.searchParams.get('city')).toBe('minsk');
    expect(url.searchParams.get('cuisines')).toBe('italian,asian');
    expect(url.searchParams.get('priceRange')).toBe('$,$$');
    expect(url.searchParams.get('features')).toBe('terrace,wifi');
    expect(url.searchParams.get('minRating')).toBe('4');
    expect(url.searchParams.get('hours_filter')).toBe('until_22');
    expect(url.searchParams.get('sort_by')).toBe('rating');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('an empty list and empty values are not sent at all', async () => {
    await getCatalog({ city: 'minsk', cuisines: [], search: '' });

    expect([...sentQuery().searchParams.keys()]).toEqual(['city']);
  });
});
