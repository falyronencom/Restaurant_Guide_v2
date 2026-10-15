/**
 * @jest-environment node
 *
 * The browser tab of the establishment page and its all-reviews page when the
 * address leads nowhere. The page bodies call notFound() on an unknown
 * city/category and on a backend 404; generateMetadata runs the same checks,
 * so the tab reads «Заведение не найдено | Nirivio» (title.template adds the
 * brand) instead of the raw address («urban-kitchen — bobruisk»).
 *
 * Mock boundary — the typed API client, as in reviews-page.test.tsx. Distinct
 * slugs per test: getCachedBySlug is wrapped in React.cache. Node environment:
 * nothing is rendered, and the detail page's imports reach next/cache (review
 * actions), which needs TextEncoder — absent from jsdom.
 */
import { generateMetadata as detailMetadata } from '@/app/(public)/[city]/[category]/[slug]/page';
import { generateMetadata as reviewsMetadata } from '@/app/(public)/[city]/[category]/[slug]/reviews/page';
import { getBySlug } from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { ApiError } from '@/lib/api/types';

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

const detail = (slug: string) => ({
  establishment: {
    slug,
    // The card's own address (establishmentAddress) — explicit, so the live
    // title does not lean on the fallback city/category.
    city_slug: 'minsk',
    category_slug: 'restaurants',
    name: 'Летняя терраса',
    description: null,
    primary_image_url: null,
  },
});

const P = (slug: string) =>
  Promise.resolve({ city: 'minsk', category: 'restaurants', slug });

const PAGES = [
  ['establishment page', detailMetadata, 'Летняя терраса — ресторан в городе Минск'],
  ['all-reviews page', reviewsMetadata, 'Отзывы — Летняя терраса'],
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
  // A live card by default: clearAllMocks keeps the previous test's
  // implementation (a 404 here would hide a skipped address check).
  (getBySlug as jest.Mock).mockResolvedValue(detail('default'));
});

describe.each(PAGES)('%s — tab title', (name, generateMetadata, liveTitle) => {
  it('a card the backend does not show (404) — «Заведение не найдено»', async () => {
    (getBySlug as jest.Mock).mockRejectedValue(new ApiError(404, 'Not found'));

    const meta = await generateMetadata({ params: P(`${name}-404`) });

    expect(meta.title).toBe('Заведение не найдено');
  });

  it('an unknown category in the address — the same, without asking for the card', async () => {
    (validateCategorySlug as jest.Mock).mockResolvedValue(false);

    const meta = await generateMetadata({ params: P(`${name}-cat`) });

    expect(meta.title).toBe('Заведение не найдено');
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('an unknown city in the address — the same', async () => {
    (validateCitySlug as jest.Mock).mockResolvedValue(false);

    const meta = await generateMetadata({ params: P(`${name}-city`) });

    expect(meta.title).toBe('Заведение не найдено');
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('a live card keeps its own title', async () => {
    (getBySlug as jest.Mock).mockResolvedValue(detail(`${name}-live`));

    const meta = await generateMetadata({ params: P(`${name}-live`) });

    expect(meta.title).toBe(liveTitle);
  });

  it('a 404 from the address check, not from the card, is not called «не найдено»', async () => {
    // The body runs these checks outside its try: such a 404 reaches the
    // error page («Что-то пошло не так»), so the tab must not say otherwise.
    (validateCitySlug as jest.Mock).mockRejectedValue(new ApiError(404, 'Edge'));

    const meta = await generateMetadata({ params: P(`${name}-edge`) });

    expect(meta.title).not.toBe('Заведение не найдено');
    expect(meta.title).toContain(`${name}-edge`);
  });

  it('a backend failure that is not 404 is not called «не найдено»', async () => {
    (getBySlug as jest.Mock).mockRejectedValue(new ApiError(500, 'Boom'));

    const meta = await generateMetadata({ params: P(`${name}-500`) });

    expect(meta.title).not.toBe('Заведение не найдено');
    expect(meta.title).toContain(`${name}-500`);
  });
});
