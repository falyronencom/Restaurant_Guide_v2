/**
 * MobileFilterDrawer — batch-model integration (the three prod-only symptoms the
 * batch rewrite fixes). Opens the real base-ui sheet, drives the FilterShelf tiles
 * in controlled mode, and asserts that a SINGLE «Применить» navigation carries the
 * accumulated local draft — with no per-tap router.push in between.
 *
 *   #1 category no longer kicks you out (it's a <button>/draft toggle, applied on
 *      «Применить», not a live <Link> navigation),
 *   #2 «Сбросить» works even with a pre-selected cuisine (clears the draft),
 *   #3 double-tap deselects (real local state — no stale-selection race).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MobileFilterDrawer } from '@/components/catalog/MobileFilterDrawer';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

const BASE = {
  citySlug: 'minsk',
  categories: [
    { slug: 'restorany', name: 'Рестораны' },
    { slug: 'bary', name: 'Бары' },
  ],
  basePath: '/minsk',
  searchParams: {},
  cuisineOptions: [
    { value: 'italian', label: 'Итальянская' },
    { value: 'asian', label: 'Азиатская' },
    { value: 'georgian', label: 'Грузинская' },
  ],
  selected: {
    cuisines: [] as string[],
    priceRange: [] as string[],
    features: [] as string[],
    hours: undefined as string | undefined,
  },
};

beforeEach(() => jest.clearAllMocks());

const openDrawer = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Фильтры/ }));
};

it('#1 category is a draft toggle — one «Применить» lands /{city}/{category}, no live nav', async () => {
  const user = userEvent.setup();
  render(<MobileFilterDrawer {...BASE} />);
  await openDrawer(user);

  // Tapping a category must NOT navigate (the old <Link> bug closed the sheet).
  await user.click(screen.getByRole('button', { name: /Рестораны/ }));
  expect(mockPush).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Применить' }));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/minsk/restorany');
});

it('applies category + a cuisine together as a single navigation', async () => {
  const user = userEvent.setup();
  render(<MobileFilterDrawer {...BASE} />);
  await openDrawer(user);

  await user.click(screen.getByRole('button', { name: /Бары/ }));
  await user.click(screen.getByRole('button', { name: 'Итальянская' }));
  expect(mockPush).not.toHaveBeenCalled(); // still batched

  await user.click(screen.getByRole('button', { name: 'Применить' }));
  expect(mockPush).toHaveBeenCalledWith('/minsk/bary?cuisine=italian');
});

it('#2 «Сбросить» clears a pre-selected cuisine → «Применить» is clean', async () => {
  const user = userEvent.setup();
  render(
    <MobileFilterDrawer
      {...BASE}
      selected={{ ...BASE.selected, cuisines: ['italian'] }}
    />,
  );
  await openDrawer(user);

  await user.click(screen.getByRole('button', { name: 'Сбросить' }));
  await user.click(screen.getByRole('button', { name: 'Применить' }));

  expect(mockPush).toHaveBeenCalledWith('/minsk');
});

it('#3 double-tap on a cuisine deselects it (local state, no race)', async () => {
  const user = userEvent.setup();
  render(<MobileFilterDrawer {...BASE} />);
  await openDrawer(user);

  const tile = screen.getByRole('button', { name: 'Грузинская' });
  await user.click(tile); // select
  await user.click(tile); // deselect (immediate — draft already updated)
  expect(mockPush).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Применить' }));
  expect(mockPush).toHaveBeenCalledWith('/minsk'); // nothing stuck selected
});

it('preserves sibling params (sort_by) and drops page on apply', async () => {
  const user = userEvent.setup();
  render(
    <MobileFilterDrawer
      {...BASE}
      searchParams={{ sort_by: 'price_asc', page: '3' }}
    />,
  );
  await openDrawer(user);

  await user.click(screen.getByRole('button', { name: 'Итальянская' }));
  await user.click(screen.getByRole('button', { name: 'Применить' }));

  const url = mockPush.mock.calls[0][0] as string;
  const params = new URLSearchParams(url.split('?')[1]);
  expect(url.split('?')[0]).toBe('/minsk');
  expect(params.get('sort_by')).toBe('price_asc');
  expect(params.get('cuisine')).toBe('italian');
  expect(params.has('page')).toBe(false);
});
