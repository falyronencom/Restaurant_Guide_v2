/**
 * @jest-environment node
 */
/*
 * The detail page when its reviews fetch fails (сверка находок тестировщика с
 * сайтом, 18.10, Х5 / Х23).
 *
 * Before: `getReviews(...).catch(() => ({ reviews: [], total: 0 }))` — the
 * carousel then said «Пока нет отзывов. Будьте первым…» about a place with
 * reviews, the anchor nav lost its count, and the ISR page kept that for an
 * hour. Now a failure hands the section to ReviewsLoadFailed (which loads the
 * reviews from the browser and drops the cached page), never to an empty
 * ReviewCarousel.
 *
 * Node environment and the call-the-Server-Component pattern of
 * establishment-address.test.tsx: the returned element tree is searched for
 * the component that fills #reviews; nothing is rendered.
 */
import type { ReactElement, ReactNode } from 'react';

import EstablishmentPage from '@/app/(public)/[city]/[category]/[slug]/page';
import { AnchorNav } from '@/components/establishment/AnchorNav';
import { ReviewCarousel } from '@/components/establishment/ReviewCarousel';
import { ReviewsLoadFailed } from '@/components/establishment/ReviewsLoadFailed';
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
  cities: [{ slug: 'minsk', name: 'Минск' }],
  categories: [{ slug: 'restaurants', name: 'Ресторан' }],
  cuisines: [],
};

function card(slug: string) {
  return {
    id: `id-${slug}`,
    slug,
    name: 'Тестовое заведение',
    description: null,
    city: 'Минск',
    city_slug: 'minsk',
    category_slug: 'restaurants',
    address: 'ул. Тестовая, 1',
    latitude: null,
    longitude: null,
    phone: null,
    website: null,
    categories: ['Ресторан'],
    cuisines: [],
    price_range: null,
    working_hours: null,
    attributes: null,
    status: 'active',
    primary_image_url: null,
    review_count: 7,
    average_rating: 4.4,
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
  };
}

/** Every element of an unrendered tree whose type is `type`. */
function findAll(node: ReactNode, type: unknown): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object' || !('props' in n)) return;
    const el = n as ReactElement<{ children?: ReactNode }>;
    if (el.type === type) out.push(el);
    walk(el.props.children);
  };
  walk(node);
  return out;
}

async function renderPage(slug: string) {
  return (await EstablishmentPage({
    params: Promise.resolve({ city: 'minsk', category: 'restaurants', slug }),
  })) as ReactElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
  (getMenuItems as jest.Mock).mockResolvedValue({ menu_items: [] });
});

it('a failed reviews fetch renders ReviewsLoadFailed — not an empty carousel («Пока нет отзывов»)', async () => {
  (getBySlug as jest.Mock).mockResolvedValue({ establishment: card('rf-1') });
  (getReviews as jest.Mock).mockRejectedValue(new ApiError(503, 'down'));

  const tree = await renderPage('rf-1');

  expect(findAll(tree, ReviewCarousel)).toHaveLength(0);
  const failed = findAll(tree, ReviewsLoadFailed);
  expect(failed).toHaveLength(1);
  expect(failed[0].props).toMatchObject({
    slug: 'rf-1',
    detailPath: '/minsk/restaurants/rf-1',
    reviewsHref: '/minsk/restaurants/rf-1/reviews',
    // The card's own count — the island's reload brings only reviews with text.
    totalCount: 7,
  });
});

/*
 * «Отзыв без текста» (11.2026, В1 = А): the card shows only reviews with
 * text, asked with with_text=true; the counts of the reviews block and of the
 * anchor nav are the card's review_count (all reviews, a rating alone
 * included) — the filtered list's pagination.total counts only the reviews
 * with text. (The title block's «N отзывов» read review_count before this
 * change too.) Fixture: 7 reviews on the card, 2 of them with text.
 */
function textReview(id: string) {
  return {
    id,
    establishment_id: 'id-rf-2',
    rating: 5,
    content: `Отзыв ${id}`,
    partner_response: null,
    partner_response_at: null,
    is_edited: false,
    created_at: '2026-05-12T10:00:00.000Z',
    updated_at: '2026-05-12T10:00:00.000Z',
    author: { id: `u-${id}`, name: `Автор ${id}`, avatar_url: null },
  };
}

it('the first reviews are asked with text only; the counts come from review_count, not the filtered total', async () => {
  (getBySlug as jest.Mock).mockResolvedValue({ establishment: card('rf-2') });
  const withText = [textReview('a'), textReview('b')];
  (getReviews as jest.Mock).mockResolvedValue({
    reviews: withText,
    pagination: { page: 1, limit: 5, total: 2, totalPages: 1, hasNext: false, hasPrevious: false },
  });

  const tree = await renderPage('rf-2');

  expect(getReviews).toHaveBeenCalledWith('rf-2', { limit: 5, with_text: true });
  expect(findAll(tree, ReviewsLoadFailed)).toHaveLength(0);
  const carousel = findAll(tree, ReviewCarousel);
  expect(carousel).toHaveLength(1);
  expect(carousel[0].props).toMatchObject({ reviews: withText, totalCount: 7 });

  const [nav] = findAll(tree, AnchorNav) as ReactElement<{
    items: { id: string; suffix?: string }[];
  }>[];
  expect(nav.props.items.find((i) => i.id === 'reviews')?.suffix).toBe(' (7)');
});

/*
 * Trunk's decision 22.11.2026: the page also asks for the latest reviews
 * without the filter — only so that an author's own review of one rating is
 * on the card for that author (ReviewCarousel `authorOnly`, kept for its
 * author by OnlyForAuthor). Fixture: latest = 2 with text + 2 without.
 */
function ratingOnlyReview(id: string) {
  return { ...textReview(id), content: null };
}

it('the latest reviews without the filter give the author-only ones: those not among the first with text', async () => {
  (getBySlug as jest.Mock).mockResolvedValue({ establishment: card('rf-5') });
  const withText = [textReview('a'), textReview('b')];
  const latest = [ratingOnlyReview('r1'), textReview('a'), ratingOnlyReview('r2'), textReview('b')];
  (getReviews as jest.Mock).mockImplementation(
    async (_slug: string, params: { with_text?: boolean }) => ({
      reviews: params.with_text ? withText : latest,
      pagination: { page: 1, limit: 5, total: params.with_text ? 2 : 7, totalPages: 1, hasNext: false, hasPrevious: false },
    }),
  );

  const tree = await renderPage('rf-5');

  expect(getReviews).toHaveBeenCalledTimes(2);
  expect(getReviews).toHaveBeenCalledWith('rf-5', { limit: 5, with_text: true });
  expect(getReviews).toHaveBeenCalledWith('rf-5', { limit: 5 });
  const [carousel] = findAll(tree, ReviewCarousel);
  expect(carousel.props).toMatchObject({
    reviews: withText,
    authorOnly: [ratingOnlyReview('r1'), ratingOnlyReview('r2')],
    totalCount: 7,
  });
});

it('the unfiltered ask failing leaves the card as for everyone: no author-only reviews', async () => {
  (getBySlug as jest.Mock).mockResolvedValue({ establishment: card('rf-6') });
  const withText = [textReview('a')];
  (getReviews as jest.Mock).mockImplementation(
    async (_slug: string, params: { with_text?: boolean }) => {
      if (!params.with_text) throw new ApiError(503, 'down');
      return {
        reviews: withText,
        pagination: { page: 1, limit: 5, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
      };
    },
  );

  const tree = await renderPage('rf-6');

  expect(findAll(tree, ReviewsLoadFailed)).toHaveLength(0);
  const [carousel] = findAll(tree, ReviewCarousel);
  expect(carousel.props).toMatchObject({ reviews: withText, authorOnly: [] });
});

it('a card with ratings only: an empty list with text, the count still review_count', async () => {
  (getBySlug as jest.Mock).mockResolvedValue({ establishment: card('rf-4') });
  (getReviews as jest.Mock).mockResolvedValue({
    reviews: [],
    pagination: { page: 1, limit: 5, total: 0, totalPages: 0, hasNext: false, hasPrevious: false },
  });

  const tree = await renderPage('rf-4');

  const [carousel] = findAll(tree, ReviewCarousel);
  expect(carousel.props).toMatchObject({ reviews: [], totalCount: 7 });
});

/*
 * Same page, its layout classes (сверка находок тестировщика с сайтом, 18.10):
 * the sticky right column clears the sticky 73px site header, and the title
 * may break inside a long word instead of running off a phone screen.
 */
function findHost(node: ReactNode, tag: string): ReactElement<{ className?: string }>[] {
  return findAll(node, tag) as ReactElement<{ className?: string }>[];
}

it('layout: the sticky sidebar sits below the site header; the h1 wraps long words', async () => {
  (getBySlug as jest.Mock).mockResolvedValue({ establishment: card('rf-3') });
  (getReviews as jest.Mock).mockRejectedValue(new ApiError(503, 'down'));

  const tree = await renderPage('rf-3');

  const [aside] = findHost(tree, 'aside');
  expect(aside.props.className).toContain('lg:top-24');
  expect(aside.props.className).not.toContain('lg:top-l');

  const [h1] = findHost(tree, 'h1');
  expect(h1.props.className).toContain('wrap-anywhere');

  // Section anchors land below header + anchor nav, not under them.
  const sections = findHost(tree, 'section');
  expect(sections.length).toBe(5);
  for (const s of sections) expect(s.props.className).toContain('scroll-mt-32');
});
