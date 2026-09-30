/**
 * /api/map route handler — the results map's data source.
 *
 * Pinned:
 *   1. Without a phrase the bounds query goes to the classic map endpoint
 *      exactly as before (no smart call, no metadata call).
 *   2. With a phrase the map shows what the list shows: the smart endpoint's
 *      whole set (page 1, limit 100 — not the viewport box), translated to the
 *      backend's Cyrillic values, as markers.
 *   3. If the smart path fails, the classic map answers WITHOUT the viewport
 *      box — the island no longer re-queries on camera moves under a phrase,
 *      so a box-bound answer would freeze whatever the first viewport held.
 *
 * Mock boundary: the typed endpoint modules; lib/smart-search runs for real.
 */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getMap: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/search', () => ({
  smartSearch: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
}));

import { GET } from '@/app/api/map/route';
import { getMap } from '@/lib/api/endpoints/establishments';
import { getMetadata } from '@/lib/api/endpoints/metadata';
import { smartSearch } from '@/lib/api/endpoints/search';
import { ApiError } from '@/lib/api/types';

const META = {
  cities: [{ slug: 'minsk', name: 'Минск' }],
  categories: [{ slug: 'cafes', name: 'Кафе' }],
  cuisines: [{ slug: 'italian', name: 'Итальянская' }],
};

const BOX = 'swLat=53.8&neLat=54&swLon=27.4&neLon=27.7&limit=500';

// jsdom has no global Request; the route only reads request.url.
function req(query: string): Request {
  return { url: `http://localhost/api/map?${query}` } as unknown as Request;
}

const LISTING = {
  id: 'e1',
  slug: 'flow',
  name: 'FLOW',
  description: null,
  city: 'Минск',
  city_slug: 'minsk',
  address: 'пр. Победителей, 1',
  latitude: 53.91,
  longitude: 27.54,
  phone: null,
  website: null,
  categories: ['Кафе'],
  category_slug: 'cafes',
  cuisines: [],
  price_range: '$$',
  working_hours: null,
  attributes: { terrace: true },
  status: 'active',
  primary_image_url: null,
  review_count: 0,
  average_rating: null,
  favorite_count: 0,
  booking_enabled: false,
  has_promotion: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (getMap as jest.Mock).mockResolvedValue({ establishments: [] });
  (smartSearch as jest.Mock).mockResolvedValue({
    intent: null,
    establishments: [LISTING],
    pagination: { page: 1, limit: 100, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    fallback: false,
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

describe('GET /api/map — without a phrase', () => {
  it('forwards the bounds query to the classic map endpoint, unchanged', async () => {
    const res = await GET(req(`${BOX}&category=cafes&cuisines=italian`));

    expect(smartSearch).not.toHaveBeenCalled();
    expect(getMetadata).not.toHaveBeenCalled();
    expect(getMap).toHaveBeenCalledWith({
      city: undefined,
      category: 'cafes',
      cuisines: ['italian'],
      priceRange: undefined,
      minRating: undefined,
      hours_filter: undefined,
      search: undefined,
      limit: 500,
      neLat: 54,
      neLon: 27.7,
      swLat: 53.8,
      swLon: 27.4,
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/map — with a phrase', () => {
  it('answers with the smart set as markers: whole set, Cyrillic values, the list’s filters', async () => {
    const res = await GET(
      req(`${BOX}&search=${encodeURIComponent('терраса')}&city=minsk&category=cafes&features=terrace`),
    );

    expect(getMap).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify((smartSearch as jest.Mock).mock.calls[0][0]))).toEqual({
      query: 'терраса',
      city: 'Минск',
      categories: ['Кафе'],
      features: ['terrace'],
      page: 1,
      limit: 100,
    });
    const body = (await res.json()) as { establishments: Array<{ id: string; slug: string }> };
    expect(body.establishments).toHaveLength(1);
    expect(body.establishments[0]).toMatchObject({ id: 'e1', slug: 'flow', latitude: 53.91 });
    expect(body.establishments[0]).not.toHaveProperty('phone');
  });

  it('metadata failure (needed only for the phrase path) → the classic phrase map, not an error', async () => {
    (getMetadata as jest.Mock).mockRejectedValue(new ApiError(0, 'Fetch failed'));

    const res = await GET(req(`${BOX}&search=${encodeURIComponent('терраса')}&city=minsk`));

    expect(res.status).toBe(200);
    expect(smartSearch).not.toHaveBeenCalled();
    expect(getMap).toHaveBeenCalledTimes(1);
    expect((getMap as jest.Mock).mock.calls[0][0]).toMatchObject({ search: 'терраса', neLat: undefined });
  });

  it('smart failure → the classic map for the phrase, without the viewport box', async () => {
    (smartSearch as jest.Mock).mockRejectedValue(new ApiError(429, 'Rate limit exceeded'));

    await GET(req(`${BOX}&search=${encodeURIComponent('терраса')}&city=minsk`));

    expect(getMap).toHaveBeenCalledTimes(1);
    const arg = (getMap as jest.Mock).mock.calls[0][0];
    expect(arg).toMatchObject({ search: 'терраса', city: 'minsk', limit: 500 });
    expect(arg.neLat).toBeUndefined();
    expect(arg.neLon).toBeUndefined();
    expect(arg.swLat).toBeUndefined();
    expect(arg.swLon).toBeUndefined();
  });
});
