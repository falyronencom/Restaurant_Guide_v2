/**
 * reloadMenuAction — the menu's retry after the detail page's own menu fetch
 * failed (сверка находок тестировщика с сайтом, 18.10, Ш8). Boundary: the
 * endpoint (endpoints/establishments) and revalidatePath (next/cache) are
 * mocked. The cached failed page is dropped on success only, and only when
 * the path is a detail address of THIS slug.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getMenuItems: jest.fn(),
}));

import { revalidatePath } from 'next/cache';

import { getMenuItems } from '@/lib/api/endpoints/establishments';
import { ApiError } from '@/lib/api/types';
import { isDetailPathOf } from '@/lib/detail-path';
import { reloadMenuAction } from '@/lib/menu/actions';

const getMenuItemsMock = getMenuItems as jest.Mock;
const revalidatePathMock = revalidatePath as jest.Mock;

const ITEM = { id: 'i1', item_name: 'Борщ' };

beforeEach(() => {
  jest.clearAllMocks();
});

it('returns the items and busts the literal detail path', async () => {
  getMenuItemsMock.mockResolvedValue({ menu_items: [ITEM] });

  const result = await reloadMenuAction({
    slug: 'some-slug',
    detailPath: '/minsk/restorany/some-slug',
  });

  expect(getMenuItemsMock).toHaveBeenCalledWith('some-slug', { visitor: null });
  expect(result).toEqual({ ok: true, menuItems: [ITEM] });
  expect(revalidatePathMock).toHaveBeenCalledWith('/minsk/restorany/some-slug');
});

it('a failure → {ok:false}, nothing revalidated', async () => {
  getMenuItemsMock.mockRejectedValue(new ApiError(503, 'down'));

  const result = await reloadMenuAction({
    slug: 'some-slug',
    detailPath: '/minsk/restorany/some-slug',
  });

  expect(result).toEqual({ ok: false });
  expect(revalidatePathMock).not.toHaveBeenCalled();
});

it('a path that is not this slug’s detail address is not revalidated', async () => {
  getMenuItemsMock.mockResolvedValue({ menu_items: [] });

  for (const detailPath of ['/', '/minsk', '/minsk/restorany/other-slug', '/a/b/some-slug/x', '/minsk/../some-slug']) {
    await reloadMenuAction({ slug: 'some-slug', detailPath });
  }

  expect(revalidatePathMock).not.toHaveBeenCalled();
});

it('isDetailPathOf — /{city}/{category}/{slug}, plain segments only', () => {
  expect(isDetailPathOf('/minsk/restorany/some-slug', 'some-slug')).toBe(true);
  expect(isDetailPathOf('/minsk/restorany/some-slug', 'other')).toBe(false);
  expect(isDetailPathOf('/minsk/res torany/some-slug', 'some-slug')).toBe(false);
  expect(isDetailPathOf('minsk/restorany/some-slug', 'some-slug')).toBe(false);
});
