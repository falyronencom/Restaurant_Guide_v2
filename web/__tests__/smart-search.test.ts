/**
 * «Текст в строке поиска ищет умно» on the web — lib/smart-search.ts.
 *
 * What is pinned here, and why each matters to a visitor:
 *   1. The phrase decides the endpoint: no phrase → the classic catalog call,
 *      unchanged; a phrase → the smart endpoint (the mobile search bar's).
 *   2. The smart body speaks the backend's language: Cyrillic city / category /
 *      cuisine names (the web's URL slugs mean nothing to /search/smart), and a
 *      filter the visitor never touched is ABSENT from the wire — an explicit
 *      sort_by would override «недорого» and the name-first order.
 *   3. The page never fails because of the smart path: any smart failure
 *      (429 from the site-wide per-IP limit, timeout, 5xx) → the classic call
 *      with the same params.
 *   4. «Ищем: …» follows the mobile header rule (dish · type · cuisine ·
 *      budget · city · order), minus «рядом с вами» (no location on the site).
 *   5. The phrase map gets the list's set (limit 100, page 1) as markers.
 *
 * Mock boundary: the typed endpoint modules. Wire bodies are compared after a
 * JSON round-trip — that is what the backend receives (undefined keys vanish),
 * and toEqual on the raw object could not tell «absent» from «undefined».
 */
import { getCatalog } from '@/lib/api/endpoints/establishments';
import { smartSearch } from '@/lib/api/endpoints/search';
import { ApiError, type PublicEstablishmentListing } from '@/lib/api/types';
import {
  describeIntent,
  getCatalogResults,
  getPhraseMapMarkers,
  toMapMarker,
} from '@/lib/smart-search';

jest.mock('@/lib/api/endpoints/establishments', () => ({
  getCatalog: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/search', () => ({
  smartSearch: jest.fn(),
}));

const META = {
  cities: [
    { slug: 'minsk', name: 'Минск' },
    { slug: 'grodno', name: 'Гродно' },
  ],
  categories: [
    { slug: 'restaurants', name: 'Ресторан' },
    { slug: 'cafes', name: 'Кафе' },
  ],
  cuisines: [
    { slug: 'italian', name: 'Итальянская' },
    { slug: 'asian', name: 'Азиатская' },
  ],
};

function listing(
  over: Partial<PublicEstablishmentListing> = {},
): PublicEstablishmentListing {
  return {
    id: 'id-1',
    slug: 'le-pigeon',
    name: 'Le Pigeon',
    description: null,
    city: 'Минск',
    city_slug: 'minsk',
    address: 'ул. Зыбицкая, 1',
    latitude: 53.9,
    longitude: 27.55,
    phone: '+375 29 000-00-00',
    website: null,
    categories: ['Ресторан'],
    category_slug: 'restaurants',
    cuisines: ['Европейская'],
    price_range: '$$',
    working_hours: null,
    attributes: { terrace: true },
    status: 'active',
    primary_image_url: 'https://res.cloudinary.com/x.jpg',
    review_count: 3,
    average_rating: 4.7,
    favorite_count: 0,
    booking_enabled: false,
    has_promotion: true,
    ...over,
  } as PublicEstablishmentListing;
}

const PAGE = { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrevious: false };
const CLASSIC = {
  establishments: [listing({ id: 'classic', name: 'Classic' })],
  pagination: PAGE,
};
const INTENT = {
  category: null,
  cuisine: null,
  dish: 'бургер',
  dish_variants: ['burger'],
  meal_type: null,
  price_max: null,
  location: null,
  sort: 'price_asc',
  tags: [],
  error: null,
};

/** The body smartSearch was called with, as the backend receives it. */
function wireBody(call = 0): Record<string, unknown> {
  return JSON.parse(JSON.stringify((smartSearch as jest.Mock).mock.calls[call][0]));
}

beforeEach(() => {
  jest.clearAllMocks();
  (getCatalog as jest.Mock).mockResolvedValue(CLASSIC);
  (smartSearch as jest.Mock).mockResolvedValue({
    intent: INTENT,
    establishments: [listing({ id: 'smart', name: 'Smart' })],
    pagination: { ...PAGE, total: 5 },
    fallback: false,
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

// ===========================================================================
// 1. The phrase decides the endpoint
// ===========================================================================

describe('getCatalogResults — which endpoint answers', () => {
  it('without a phrase: the classic catalog call, params untouched, no smart call', async () => {
    const params = { city: 'minsk', category: 'restaurants', cuisines: ['italian'], page: 2 };

    const res = await getCatalogResults(params, META);

    expect(smartSearch).not.toHaveBeenCalled();
    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(getCatalog).toHaveBeenCalledWith(params);
    expect(res).toEqual({ ...CLASSIC, understood: null, sortFromPhrase: null });
  });

  it('a whitespace-only phrase is no phrase: classic', async () => {
    await getCatalogResults({ city: 'minsk', search: '   ' }, META);

    expect(smartSearch).not.toHaveBeenCalled();
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });

  it('with a phrase: the smart endpoint answers, the classic catalog is not called', async () => {
    const res = await getCatalogResults({ city: 'minsk', search: 'бургер недорого' }, META);

    expect(smartSearch).toHaveBeenCalledTimes(1);
    expect(getCatalog).not.toHaveBeenCalled();
    expect(res.establishments.map((e) => e.id)).toEqual(['smart']);
    expect(res.pagination.total).toBe(5);
    expect(res.understood).toBe('бургер · недорого');
    expect(res.sortFromPhrase).toBe('price_asc');
  });

  it('reports only a sort order the site offers — «рядом» (distance) is not one', async () => {
    (smartSearch as jest.Mock).mockResolvedValue({
      intent: { ...INTENT, sort: 'distance' },
      establishments: [],
      pagination: PAGE,
      fallback: false,
    });

    const res = await getCatalogResults({ city: 'minsk', search: 'кофе рядом' }, META);

    expect(res.sortFromPhrase).toBeNull();
  });
});

// ===========================================================================
// 2. The smart body — Cyrillic values, untouched filters absent
// ===========================================================================

describe('getCatalogResults — the smart body on the wire', () => {
  it('translates slugs to the backend values and carries every chosen filter', async () => {
    await getCatalogResults(
      {
        city: 'minsk',
        category: 'restaurants',
        cuisines: ['italian', 'asian'],
        priceRange: ['$', '$$'],
        features: ['terrace', 'wifi'],
        hours_filter: 'until_22',
        minRating: 4,
        sort_by: 'price_desc',
        page: 2,
        search: '  пицца  ',
      },
      META,
    );

    expect(wireBody()).toEqual({
      query: 'пицца',
      city: 'Минск',
      categories: ['Ресторан'],
      cuisines: ['Итальянская', 'Азиатская'],
      priceRange: ['$', '$$'],
      features: ['terrace', 'wifi'],
      hours_filter: 'until_22',
      minRating: 4,
      sort_by: 'price_desc',
      page: 2,
    });
  });

  it('a filter the visitor never touched is absent — above all sort_by', async () => {
    await getCatalogResults({ city: 'minsk', search: 'бургер недорого' }, META);

    expect(wireBody()).toEqual({ query: 'бургер недорого', city: 'Минск' });
    expect(wireBody()).not.toHaveProperty('sort_by');
  });

  it('soft-ignores an unknown amenity key, as the public catalog does', async () => {
    await getCatalogResults(
      { city: 'minsk', features: ['terrace', 'jacuzzi'], search: 'кофе' },
      META,
    );

    expect(wireBody().features).toEqual(['terrace']);
  });

  it('keeps the classic path for an untranslatable cuisine slug (that URL answers as it always has)', async () => {
    await getCatalogResults(
      { city: 'minsk', cuisines: ['atlantean'], search: 'кофе' },
      META,
    );

    expect(smartSearch).not.toHaveBeenCalled();
    expect(getCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: ['atlantean'], search: 'кофе' }),
    );
  });

  it('keeps the classic path for an untranslatable category slug', async () => {
    await getCatalogResults({ city: 'minsk', category: 'spaceports', search: 'кофе' }, META);

    expect(smartSearch).not.toHaveBeenCalled();
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3. The page never fails because of the smart path
// ===========================================================================

describe('getCatalogResults — fallback', () => {
  it.each([
    ['429 — the site-wide per-IP smart limit', new ApiError(429, 'Rate limit exceeded')],
    ['0 — timeout / transport', new ApiError(0, 'Fetch failed')],
    ['500 — outage', new ApiError(500, 'Internal')],
  ])('smart endpoint fails with %s → the classic call with the same params', async (_label, error) => {
    (smartSearch as jest.Mock).mockRejectedValue(error);
    const params = { city: 'minsk', category: 'restaurants', search: 'терраса', page: 1 };

    const res = await getCatalogResults(params, META);

    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(getCatalog).toHaveBeenCalledWith(params);
    expect(res).toEqual({ ...CLASSIC, understood: null, sortFromPhrase: null });
  });

  it('logs the failure status, never the visitor’s words', async () => {
    (smartSearch as jest.Mock).mockRejectedValue(new ApiError(429, 'Rate limit exceeded'));

    await getCatalogResults({ city: 'minsk', search: 'секретная фраза' }, META);

    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('429');
    expect(logged).not.toContain('секретная фраза');
  });

  it('backend fallback (AI unavailable) keeps its results but shows no «Ищем»', async () => {
    (smartSearch as jest.Mock).mockResolvedValue({
      intent: null,
      establishments: [listing({ id: 'raw' })],
      pagination: PAGE,
      fallback: true,
    });

    const res = await getCatalogResults({ city: 'minsk', search: 'терраса' }, META);

    expect(getCatalog).not.toHaveBeenCalled();
    expect(res.establishments.map((e) => e.id)).toEqual(['raw']);
    expect(res.understood).toBeNull();
  });
});

// ===========================================================================
// 4. «Ищем: …» — the mobile header rule
// ===========================================================================

describe('describeIntent', () => {
  const blank = { ...INTENT, dish: null, dish_variants: [], sort: null };

  it('dish first, then type, cuisines, budget, city, order — joined by « · »', () => {
    expect(
      describeIntent({
        ...blank,
        dish: 'пицца',
        category: 'Ресторан',
        cuisine: ['Итальянская', 'Европейская'],
        price_max: 20,
        location: 'Гродно',
        sort: 'rating',
      }),
    ).toBe('пицца · Ресторан · Итальянская, Европейская · до 20 BYN · Гродно · лучшие');
  });

  it('prints a whole budget without «.0» and a fractional one as is', () => {
    expect(describeIntent({ ...blank, price_max: 20.0 })).toBe('до 20 BYN');
    expect(describeIntent({ ...blank, price_max: 19.5 })).toBe('до 19.5 BYN');
  });

  it('«недорого» for price_asc', () => {
    expect(describeIntent({ ...blank, sort: 'price_asc' })).toBe('недорого');
  });

  it('no «рядом с вами»: the site has no visitor location', () => {
    expect(describeIntent({ ...blank, dish: 'кофе', sort: 'distance' })).toBe('кофе');
  });

  it('meal type and amenity words are not shown (mobile does not show them either)', () => {
    expect(describeIntent({ ...blank, meal_type: 'breakfast', tags: ['терраса'] })).toBeNull();
  });

  it('null for no intent and for an empty cuisine list', () => {
    expect(describeIntent(null)).toBeNull();
    expect(describeIntent({ ...blank, cuisine: [] })).toBeNull();
  });
});

// ===========================================================================
// 5. The phrase map
// ===========================================================================

describe('getPhraseMapMarkers', () => {
  it('asks for the whole set — page 1, the endpoint ceiling of 100 — with the list’s filters', async () => {
    await getPhraseMapMarkers(
      { city: 'minsk', category: 'cafes', features: ['terrace'], search: 'терраса' },
      META,
    );

    expect(wireBody()).toEqual({
      query: 'терраса',
      city: 'Минск',
      categories: ['Кафе'],
      features: ['terrace'],
      page: 1,
      limit: 100,
    });
  });

  it('returns the smart results as map markers', async () => {
    const markers = await getPhraseMapMarkers({ city: 'minsk', search: 'терраса' }, META);

    expect(markers).toEqual([toMapMarker(listing({ id: 'smart', name: 'Smart' }))]);
  });

  it('null (→ classic map) without a phrase, and when the smart endpoint fails', async () => {
    expect(await getPhraseMapMarkers({ city: 'minsk' }, META)).toBeNull();
    expect(smartSearch).not.toHaveBeenCalled();

    (smartSearch as jest.Mock).mockRejectedValue(new ApiError(429, 'limit'));
    expect(await getPhraseMapMarkers({ city: 'minsk', search: 'терраса' }, META)).toBeNull();
  });
});

describe('toMapMarker', () => {
  it('keeps exactly the marker projection’s fields (backend toPublicEstablishmentMapMarker)', () => {
    expect(toMapMarker(listing())).toEqual({
      id: 'id-1',
      slug: 'le-pigeon',
      name: 'Le Pigeon',
      city: 'Минск',
      city_slug: 'minsk',
      address: 'ул. Зыбицкая, 1',
      categories: ['Ресторан'],
      category_slug: 'restaurants',
      price_range: '$$',
      latitude: 53.9,
      longitude: 27.55,
      primary_image_url: 'https://res.cloudinary.com/x.jpg',
      review_count: 3,
      average_rating: 4.7,
      has_promotion: true,
    });
  });
});
