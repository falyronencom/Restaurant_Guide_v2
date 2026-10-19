/**
 * @jest-environment node
 */
/*
 * The detail page hands a failed menu fetch to MenuBlock as «not loaded»
 * (`menuItems` null), not as an empty menu (сверка находок тестировщика с
 * сайтом, 18.10, Ш8). Before, `.catch(() => ({ menu_items: [] }))` made the
 * failure read «Меню пока не загружено.», and the ISR page kept it for up to
 * an hour. The page is not rendered: its returned element tree is searched for
 * the MenuBlock element and its props are read (MenuBlock's own output lives
 * in menu-block / menu-load-failed tests).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import EstablishmentPage from '@/app/(public)/[city]/[category]/[slug]/page';
import { MenuBlock } from '@/components/establishment/MenuBlock';
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

const CARD = {
  id: 'id-kafe',
  slug: 'kafe',
  name: 'Тестовое кафе',
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
};

/** The first element of `type` anywhere in an element tree. */
function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return findElement((node.props as { children?: ReactNode }).children, type);
}

async function menuBlockProps() {
  const ui = await EstablishmentPage({
    params: Promise.resolve({ city: 'minsk', category: 'restaurants', slug: 'kafe' }),
  });
  const block = findElement(ui, MenuBlock);
  expect(block).not.toBeNull();
  return block!.props as {
    menuItems: unknown[] | null;
    slug?: string;
    detailPath?: string;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue({
    cities: [{ slug: 'minsk', name: 'Минск' }],
    categories: [{ slug: 'restaurants', name: 'Ресторан' }],
    cuisines: [],
  });
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
  (getBySlug as jest.Mock).mockResolvedValue({ establishment: CARD });
  (getReviews as jest.Mock).mockResolvedValue({
    reviews: [],
    pagination: { page: 1, limit: 5, total: 0, totalPages: 0, hasNext: false, hasPrevious: false },
  });
});

it('a failed menu fetch reaches MenuBlock as null — «not loaded», with whose page to retry', async () => {
  (getMenuItems as jest.Mock).mockRejectedValue(new ApiError(503, 'down'));

  const props = await menuBlockProps();

  expect(props.menuItems).toBeNull();
  expect(props.slug).toBe('kafe');
  expect(props.detailPath).toBe('/minsk/restaurants/kafe');
});

it('a loaded empty menu stays an empty list', async () => {
  (getMenuItems as jest.Mock).mockResolvedValue({ menu_items: [] });

  expect((await menuBlockProps()).menuItems).toEqual([]);
});
