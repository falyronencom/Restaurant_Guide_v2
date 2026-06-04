/**
 * /[city]/[category]/[slug]/reviews — dedicated all-reviews page (Phase A).
 *
 * Same async-RSC pattern as city-page.test.tsx / catalog-filters.test.tsx: mock
 * the typed API client boundary (@/lib/api/endpoints/*), invoke the async Server
 * Component as a function, await the returned element, render() under RTL.
 *
 * Shape contracts asserted:
 *   1. Invalid city/category slug → notFound() (validateCitySlug/Category gate,
 *      short-circuits before getBySlug). Plus getBySlug ApiError(404) → notFound.
 *   2. Empty reviews list is a VALID state → graceful empty-state, no throw.
 *   3. getReviews(slug, { page, limit: 10 }) — page parsed from searchParams.
 *   4. Happy path → a ReviewCard per review renders.
 *
 * Distinct slugs per test avoid React.cache (getCachedBySlug) memoising a
 * resolved value across tests within this module.
 */
import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';

import ReviewsPage from '@/app/(public)/[city]/[category]/[slug]/reviews/page';
import { getBySlug, getReviews } from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { ApiError } from '@/lib/api/types';

// notFound() throws in real Next to halt rendering — mirror that so the 404
// branches are observable as rejections.
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

// Mock boundary: the typed API client. Bare jest.fn()s, return values set per
// test (avoids the resetMocks factory-wipe trap — see feedback_jest_resetmocks).
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getBySlug: jest.fn(),
  getReviews: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));

const META = {
  cities: [{ slug: 'minsk', name: 'Минск' }],
  categories: [{ slug: 'restorany', name: 'Рестораны' }],
  cuisines: [],
};

const makeEstablishment = (slug: string) => ({
  id: 'est-1',
  slug,
  name: 'Тестовое заведение',
  description: null,
  city: 'Минск',
  city_slug: 'minsk',
  address: 'ул. Тестовая, 1',
  latitude: null,
  longitude: null,
  phone: null,
  website: null,
  categories: ['Ресторан'],
  category_slug: 'restorany',
  cuisines: [],
  price_range: null,
  working_hours: null,
  attributes: null,
  status: 'published',
  primary_image_url: null,
  review_count: 4,
  average_rating: 4.6,
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
});

const makeReview = (id: string, name: string, content: string) => ({
  id,
  establishment_id: 'est-1',
  rating: 5,
  content,
  partner_response: null,
  partner_response_at: null,
  is_edited: false,
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  author: { id: `user-${id}`, name, avatar_url: null },
});

const pagination = (overrides = {}) => ({
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
  ...overrides,
});

const P = (slug: string) =>
  Promise.resolve({ city: 'minsk', category: 'restorany', slug });
const SP = (o: Record<string, string | string[] | undefined>) =>
  Promise.resolve(o);

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
});

// ===========================================================================
// 1. Invalid slugs → notFound
// ===========================================================================

describe('ReviewsPage — 404 branches', () => {
  it('calls notFound() for an unknown city slug (gate short-circuits before getBySlug)', async () => {
    (validateCitySlug as jest.Mock).mockResolvedValue(false);

    await expect(
      ReviewsPage({ params: P('any-slug-a'), searchParams: SP({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('calls notFound() for an unknown category slug', async () => {
    (validateCategorySlug as jest.Mock).mockResolvedValue(false);

    await expect(
      ReviewsPage({ params: P('any-slug-b'), searchParams: SP({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('calls notFound() when getBySlug throws ApiError 404 (unknown establishment)', async () => {
    (getBySlug as jest.Mock).mockRejectedValue(new ApiError(404, 'Not found'));

    await expect(
      ReviewsPage({ params: P('ghost-slug'), searchParams: SP({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalledTimes(1);
    // getReviews never runs once the entity 404s.
    expect(getReviews).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. Empty reviews list → graceful empty-state (NOT 404 / fallback)
// ===========================================================================

describe('ReviewsPage — empty reviews state', () => {
  it('renders the empty-state copy and does not call notFound', async () => {
    (getBySlug as jest.Mock).mockResolvedValue({
      establishment: makeEstablishment('empty-slug'),
    });
    (getReviews as jest.Mock).mockResolvedValue({
      reviews: [],
      pagination: pagination({ total: 0, totalPages: 0 }),
    });

    const ui = await ReviewsPage({
      params: P('empty-slug'),
      searchParams: SP({}),
    });
    const { container } = render(ui);

    expect(
      screen.getByText('Пока нет отзывов. Будьте первым, кто оставит отзыв!'),
    ).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    // ReviewSchema emits nothing for an empty list.
    expect(
      container.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
  });
});

// ===========================================================================
// 3. searchParams page → getReviews fetch params
// ===========================================================================

describe('ReviewsPage — getReviews pagination params', () => {
  it('calls getReviews with the page parsed from searchParams + limit 10', async () => {
    (getBySlug as jest.Mock).mockResolvedValue({
      establishment: makeEstablishment('page-slug'),
    });
    (getReviews as jest.Mock).mockResolvedValue({
      reviews: [],
      pagination: pagination({ page: 2, total: 0, totalPages: 0 }),
    });

    await ReviewsPage({ params: P('page-slug'), searchParams: SP({ page: '2' }) });

    expect(getReviews).toHaveBeenCalledWith('page-slug', { page: 2, limit: 10 });
  });

  it('defaults to page 1 when no page searchParam is present', async () => {
    (getBySlug as jest.Mock).mockResolvedValue({
      establishment: makeEstablishment('default-page-slug'),
    });
    (getReviews as jest.Mock).mockResolvedValue({
      reviews: [],
      pagination: pagination(),
    });

    await ReviewsPage({ params: P('default-page-slug'), searchParams: SP({}) });

    expect(getReviews).toHaveBeenCalledWith('default-page-slug', {
      page: 1,
      limit: 10,
    });
  });
});

// ===========================================================================
// 4. Happy path — review list renders
// ===========================================================================

describe('ReviewsPage — review list render', () => {
  it('renders one card per review with author + content', async () => {
    (getBySlug as jest.Mock).mockResolvedValue({
      establishment: makeEstablishment('happy-slug'),
    });
    (getReviews as jest.Mock).mockResolvedValue({
      reviews: [
        makeReview('r1', 'Анна', 'Прекрасное место, всем советую.'),
        makeReview('r2', 'Борис', 'Отличная кухня и сервис.'),
      ],
      pagination: pagination({ total: 2, totalPages: 1 }),
    });

    const ui = await ReviewsPage({
      params: P('happy-slug'),
      searchParams: SP({}),
    });
    render(ui);

    expect(
      screen.getByText('Прекрасное место, всем советую.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Отличная кухня и сервис.')).toBeInTheDocument();
    expect(screen.getByText('Анна')).toBeInTheDocument();
    expect(screen.getByText('Борис')).toBeInTheDocument();
    // Empty-state must NOT be shown when reviews exist.
    expect(
      screen.queryByText('Пока нет отзывов. Будьте первым, кто оставит отзыв!'),
    ).toBeNull();
  });
});
