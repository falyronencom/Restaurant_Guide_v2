/**
 * @jest-environment node
 */
/**
 * Visitors' requests that drop a cached card page (thread «2Г: общие пределы»,
 * review of 10.11.2026). A dropped ISR page renders anew from the site's own
 * budget on the API — three calls and more — so one visitor's request cost the
 * site several of its own, and enough of them closed the uncached cards to
 * everyone. Pinned here, with literals of the choice (lib/cached-page-drops.ts):
 *   - one visitor drops at most 10 pages an hour, and the next visitor still
 *     drops theirs (one did not take the hour of the others);
 *   - the whole site drops at most 120 an hour; the next hour renews it;
 *   - a review action drops only a card address, never what the browser names
 *     (the sitemap, the home page).
 */
const headerStore = new Headers();

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve({ get: jest.fn() })),
  headers: jest.fn(() => Promise.resolve(headerStore)),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getMenuItems: jest.fn(),
  getReviews: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/reviews', () => ({
  createReview: jest.fn(),
  updateReview: jest.fn(),
  deleteReview: jest.fn(),
}));

import { revalidatePath } from 'next/cache';

import { getMenuItems, getReviews } from '@/lib/api/endpoints/establishments';
import { createReview, updateReview } from '@/lib/api/endpoints/reviews';
import { _resetForTests } from '@/lib/cached-page-drops';
import { reloadMenuAction } from '@/lib/menu/actions';
import { createReviewAction, reloadReviewsAction, updateReviewAction } from '@/lib/reviews/actions';

const revalidatePathMock = revalidatePath as jest.Mock;
const PATH = '/minsk/restorany/some-slug';
const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-11-10T09:00:00.000Z');

const asVisitor = (address: string) => {
  headerStore.set('x-forwarded-for', `${address}, 152.233.10.1`);
};
const reloadMenu = () => reloadMenuAction({ slug: 'some-slug', detailPath: PATH });

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  jest.spyOn(Date, 'now').mockReturnValue(START);
  (getMenuItems as jest.Mock).mockResolvedValue({ menu_items: [] });
  (getReviews as jest.Mock).mockResolvedValue({ reviews: [], pagination: { total: 0 } });
  (createReview as jest.Mock).mockResolvedValue({});
  (updateReview as jest.Mock).mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('one visitor: the 10th drop of the hour goes, the 11th does not — and the next visitor still drops', async () => {
  asVisitor('203.0.113.50');
  for (let i = 0; i < 9; i += 1) await reloadMenu();
  expect(revalidatePathMock).toHaveBeenCalledTimes(9);

  await reloadMenu(); // the 10th
  expect(revalidatePathMock).toHaveBeenCalledTimes(10);

  // The 11th: the menu is still answered, the page is not dropped.
  await expect(reloadMenu()).resolves.toEqual({ ok: true, menuItems: [] });
  await reloadReviewsAction({ slug: 'some-slug', detailPath: PATH });
  expect(revalidatePathMock).toHaveBeenCalledTimes(10);

  asVisitor('203.0.113.51');
  await reloadMenu();
  expect(revalidatePathMock).toHaveBeenCalledTimes(11);
});

it('the whole site: the 120th drop of the hour goes, the 121st does not; the next hour renews it', async () => {
  for (let v = 0; v < 12; v += 1) {
    asVisitor(`203.0.113.${100 + v}`);
    for (let i = 0; i < 10; i += 1) await reloadMenu();
  }
  expect(revalidatePathMock).toHaveBeenCalledTimes(120);

  asVisitor('198.51.100.7');
  await reloadMenu();
  expect(revalidatePathMock).toHaveBeenCalledTimes(120);

  jest.spyOn(Date, 'now').mockReturnValue(START + HOUR);
  await reloadMenu();
  expect(revalidatePathMock).toHaveBeenCalledTimes(121);
});

it.each([
  ['the sitemap', '/sitemap.xml'],
  ['the home page', '/'],
  ['a city page', '/minsk'],
  ['a card address with a query', '/minsk/restorany/some-slug?x=1'],
])('a review action does not drop %s, whatever the browser names', async (_label, detailPath) => {
  asVisitor('203.0.113.60');

  await expect(createReviewAction({
    establishmentId: '11111111-1111-1111-1111-111111111111', rating: 5, content: 'Хорошо.', detailPath,
  })).resolves.toEqual({ ok: true });
  await expect(updateReviewAction({ reviewId: 'r-1', rating: 4, content: 'Хорошо.', detailPath }))
    .resolves.toEqual({ ok: true });

  expect(revalidatePathMock).not.toHaveBeenCalled();
});

it('a review on a card address drops that page, from the same allowance', async () => {
  asVisitor('203.0.113.61');

  await createReviewAction({
    establishmentId: '11111111-1111-1111-1111-111111111111', rating: 5, content: 'Хорошо.', detailPath: PATH,
  });

  expect(revalidatePathMock).toHaveBeenCalledWith(PATH);
});
