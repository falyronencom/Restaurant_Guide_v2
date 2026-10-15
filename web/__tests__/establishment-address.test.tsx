/**
 * @jest-environment node
 */
/*
 * One address per establishment card — the detail page and its /reviews page.
 *
 * The backend looks a card up by its slug alone (slugs are globally unique), so
 * the pages used to check only that the city and the category in the address
 * EXIST: /minsk/bars/<a restaurant> opened the restaurant just like
 * /minsk/restaurants/<it>, and generateMetadata put the REQUEST path into
 * rel=canonical — one card, as many "canonical" addresses as there are
 * city × category pairs.
 *
 * The rule asserted here:
 *   1. A card's address is /{city_slug}/{category_slug}/{slug} built from the
 *      card itself (establishmentAddress). A card whose city/category sits
 *      outside the URL canon takes the fallbacks most of the site's links
 *      already use (minsk / restaurants), so it still has exactly one address.
 *   2. A known but foreign city/category → permanentRedirect to that address,
 *      before menu and reviews are fetched; the reviews page keeps its ?page.
 *   3. canonical comes from the card, never from the request; when the card
 *      cannot be loaded there is no canonical at all.
 *   4. An unknown city/category is still notFound(), not a redirect: only a
 *      KNOWN city/category makes a foreign address of the card.
 *
 * Same async-RSC pattern as reviews-page.test.tsx: mock the typed API client
 * boundary, call the Server Component / generateMetadata as a function, do not
 * render. Node environment, as in live-cities.test.ts: the detail page pulls
 * server actions (next/cache → TextEncoder, absent in jsdom). Distinct slugs
 * per test keep each test's card its own.
 */
import { notFound, permanentRedirect } from 'next/navigation';

import EstablishmentPage, {
  generateMetadata as generateDetailMetadata,
} from '@/app/(public)/[city]/[category]/[slug]/page';
import ReviewsPage, {
  generateMetadata as generateReviewsMetadata,
} from '@/app/(public)/[city]/[category]/[slug]/reviews/page';
import {
  getBySlug,
  getMenuItems,
  getReviews,
} from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { ApiError } from '@/lib/api/types';

// notFound() / permanentRedirect() throw in real Next to halt rendering —
// mirror that so both branches are observable as rejections.
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  permanentRedirect: jest.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

jest.mock('@/lib/api/endpoints/establishments', () => ({
  getBySlug: jest.fn(),
  getMenuItems: jest.fn(),
  getReviews: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));

const META = {
  cities: [
    { slug: 'minsk', name: 'Минск' },
    { slug: 'grodno', name: 'Гродно' },
  ],
  categories: [
    { slug: 'restaurants', name: 'Ресторан' },
    { slug: 'bars', name: 'Бар' },
  ],
  cuisines: [],
};

const EMPTY_PAGE = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/** A restaurant in Minsk — its own address is /minsk/restaurants/{slug}. */
function card(
  slug: string,
  slugs: { city_slug: string | null; category_slug: string | null } = {
    city_slug: 'minsk',
    category_slug: 'restaurants',
  },
) {
  return {
    id: `id-${slug}`,
    slug,
    name: 'Тестовое заведение',
    description: null,
    city: 'Минск',
    address: 'ул. Тестовая, 1',
    latitude: null,
    longitude: null,
    phone: null,
    website: null,
    categories: ['Ресторан', 'Бар'],
    cuisines: [],
    price_range: null,
    working_hours: null,
    attributes: null,
    status: 'active',
    primary_image_url: null,
    review_count: 0,
    average_rating: null,
    favorite_count: 0,
    booking_enabled: false,
    has_promotion: false,
    promotion_count: 0,
    published_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    email: null,
    special_hours: null,
    view_count: 0,
    media: [],
    promotions: [],
    ...slugs,
  };
}

function serve(establishment: ReturnType<typeof card>) {
  (getBySlug as jest.Mock).mockResolvedValue({ establishment });
}

const P = (city: string, category: string, slug: string) =>
  Promise.resolve({ city, category, slug });
const SP = (o: Record<string, string | string[] | undefined>) =>
  Promise.resolve(o);

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
  (getMenuItems as jest.Mock).mockResolvedValue({ menu_items: [] });
  (getReviews as jest.Mock).mockResolvedValue({
    reviews: [],
    pagination: EMPTY_PAGE,
  });
});

// ===========================================================================
// Detail page
// ===========================================================================

describe('establishment page — one address per card', () => {
  it('opens at its own address without a redirect', async () => {
    serve(card('own-address'));

    const ui = await EstablishmentPage({
      params: P('minsk', 'restaurants', 'own-address'),
    });

    expect(ui).toBeTruthy();
    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('redirects permanently from a foreign category to the card’s own address', async () => {
    serve(card('foreign-category'));

    await expect(
      EstablishmentPage({ params: P('minsk', 'bars', 'foreign-category') }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(permanentRedirect).toHaveBeenCalledWith(
      '/minsk/restaurants/foreign-category',
    );
    // The redirect costs one backend call, not three.
    expect(getMenuItems).not.toHaveBeenCalled();
    expect(getReviews).not.toHaveBeenCalled();
  });

  it('redirects permanently from a foreign city', async () => {
    serve(card('foreign-city'));

    await expect(
      EstablishmentPage({ params: P('grodno', 'restaurants', 'foreign-city') }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(permanentRedirect).toHaveBeenCalledWith(
      '/minsk/restaurants/foreign-city',
    );
  });

  it('still answers 404, not a redirect, for an unknown category', async () => {
    (validateCategorySlug as jest.Mock).mockResolvedValue(false);

    await expect(
      EstablishmentPage({ params: P('minsk', 'zz-kategoriya', 'any-slug') }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    // The gate runs before the card is looked up, as it did before.
    expect(getBySlug).not.toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('sends a card outside the URL canon to the fallback address', async () => {
    serve(card('legacy-card', { city_slug: null, category_slug: null }));

    await expect(
      EstablishmentPage({ params: P('grodno', 'bars', 'legacy-card') }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(permanentRedirect).toHaveBeenCalledWith(
      '/minsk/restaurants/legacy-card',
    );
  });

  it('opens a card outside the URL canon at the fallback address', async () => {
    serve(card('legacy-home', { city_slug: null, category_slug: null }));

    const ui = await EstablishmentPage({
      params: P('minsk', 'restaurants', 'legacy-home'),
    });

    expect(ui).toBeTruthy();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });
});

describe('establishment metadata — canonical from the card, not the request', () => {
  it('is the card’s own address when opened there', async () => {
    serve(card('meta-own'));

    const meta = await generateDetailMetadata({
      params: P('minsk', 'restaurants', 'meta-own'),
    });

    expect(meta.alternates?.canonical).toBe('/minsk/restaurants/meta-own');
  });

  it('stays the card’s own address under a foreign category', async () => {
    serve(card('meta-foreign'));

    const meta = await generateDetailMetadata({
      params: P('minsk', 'bars', 'meta-foreign'),
    });

    expect(meta.alternates?.canonical).toBe('/minsk/restaurants/meta-foreign');
    // The title names the card's own category, not the one in the address.
    expect(meta.title).toBe('Тестовое заведение — ресторан в городе Минск');
  });

  it('is the fallback address for a card outside the URL canon', async () => {
    serve(card('meta-legacy', { city_slug: null, category_slug: null }));

    const meta = await generateDetailMetadata({
      params: P('grodno', 'bars', 'meta-legacy'),
    });

    expect(meta.alternates?.canonical).toBe('/minsk/restaurants/meta-legacy');
  });

  it('is absent when the card cannot be loaded', async () => {
    (getBySlug as jest.Mock).mockRejectedValue(new ApiError(404, 'Not found'));

    const meta = await generateDetailMetadata({
      params: P('minsk', 'restaurants', 'meta-ghost'),
    });

    expect(meta.alternates?.canonical).toBeUndefined();
  });
});

// ===========================================================================
// /reviews page — the same card, the same rule
// ===========================================================================

describe('reviews page — one address per card', () => {
  it('opens at the card’s own address without a redirect', async () => {
    serve(card('reviews-own'));

    const ui = await ReviewsPage({
      params: P('minsk', 'restaurants', 'reviews-own'),
      searchParams: SP({}),
    });

    expect(ui).toBeTruthy();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('redirects from a foreign category to the card’s own /reviews', async () => {
    serve(card('reviews-foreign'));

    await expect(
      ReviewsPage({
        params: P('minsk', 'bars', 'reviews-foreign'),
        searchParams: SP({}),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(permanentRedirect).toHaveBeenCalledWith(
      '/minsk/restaurants/reviews-foreign/reviews',
    );
    expect(getReviews).not.toHaveBeenCalled();
  });

  it('keeps the page number through the redirect', async () => {
    serve(card('reviews-paged'));

    await expect(
      ReviewsPage({
        params: P('grodno', 'restaurants', 'reviews-paged'),
        searchParams: SP({ page: '3' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(permanentRedirect).toHaveBeenCalledWith(
      '/minsk/restaurants/reviews-paged/reviews?page=3',
    );
  });

  it('canonical is the card’s own /reviews under a foreign category', async () => {
    serve(card('reviews-meta'));

    const meta = await generateReviewsMetadata({
      params: P('minsk', 'bars', 'reviews-meta'),
    });

    expect(meta.alternates?.canonical).toBe(
      '/minsk/restaurants/reviews-meta/reviews',
    );
  });

  it('has no canonical when the card cannot be loaded', async () => {
    (getBySlug as jest.Mock).mockRejectedValue(new ApiError(404, 'Not found'));

    const meta = await generateReviewsMetadata({
      params: P('minsk', 'restaurants', 'reviews-ghost'),
    });

    expect(meta.alternates?.canonical).toBeUndefined();
  });
});
