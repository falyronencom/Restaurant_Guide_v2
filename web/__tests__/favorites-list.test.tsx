/**
 * FavoritesList island — hydrates the authed list via the account client,
 * guards anon (NO_SESSION → /login?returnTo=/favorites), renders reused
 * catalog EstablishmentCards inside a real FavoritesProvider, and removes a
 * card in place when its heart is toggled off (with rollback restore on a
 * failed remove). The account client and the favorites Server Actions are
 * mocked; AuthProvider is stubbed authenticated.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FavoriteListItem } from '@/lib/api/types';

const mockReplace = jest.fn();
// Stable identity, mirroring the real useRouter — the island's effect depends
// on [router]; a per-render object would re-run it in a loop.
const mockRouter = { replace: mockReplace, push: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/favorites',
}));
jest.mock('@/lib/account/client', () => ({ loadFavorites: jest.fn() }));
const mockMarkAnonymous = jest.fn();
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    isAuthenticated: true,
    user: { id: 'u1', email: 'v@e.by', name: 'В', role: 'user', avatarUrl: null },
    requestLogin: jest.fn(),
    logout: jest.fn(),
    loginError: null,
    applySession: jest.fn(),
    markAnonymous: mockMarkAnonymous,
  }),
}));
jest.mock('@/lib/favorites/actions', () => ({
  getFavoritesForIds: jest.fn(),
  addFavoriteAction: jest.fn(),
  removeFavoriteAction: jest.fn(),
}));

import {
  getFavoritesForIds,
  removeFavoriteAction,
} from '@/lib/favorites/actions';
import { loadFavorites } from '@/lib/account/client';
import { FavoritesList } from '@/components/account/FavoritesList';

const mockLoadFavorites = loadFavorites as jest.Mock;
const mockGetFavoritesForIds = getFavoritesForIds as jest.Mock;
const mockRemoveFavorite = removeFavoriteAction as jest.Mock;

function item(n: number): FavoriteListItem {
  return {
    id: `fav-${n}`,
    user_id: 'u1',
    establishment_id: `est-${n}`,
    created_at: '2026-07-01T10:00:00.000Z',
    establishment_slug: `slug-${n}`,
    establishment_city_slug: 'minsk',
    establishment_category_slug: 'cafes',
    establishment_name: `Кафе ${n}`,
    establishment_description: null,
    establishment_city: 'Минск',
    establishment_address: `ул. Тестовая, ${n}`,
    establishment_latitude: 53.9,
    establishment_longitude: 27.5,
    establishment_categories: ['Кафе'],
    establishment_cuisines: ['Европейская'],
    establishment_price_range: '$$',
    establishment_average_rating: 4.5,
    establishment_review_count: 12,
    establishment_status: 'active',
    establishment_working_hours: null,
    establishment_primary_image: null,
  };
}

function readyPage(
  items: FavoriteListItem[],
  { page = 1, hasNext = false } = {},
) {
  return { ok: true, favorites: items, page, hasNext };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFavoritesForIds.mockResolvedValue({});
  mockRemoveFavorite.mockResolvedValue({ ok: true, isFavorite: false });
});

it('redirects an anonymous visitor to /login with returnTo, syncing the auth context first', async () => {
  mockLoadFavorites.mockResolvedValue({ ok: false, code: 'NO_SESSION' });
  render(<FavoritesList />);
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/login?returnTo=/favorites'),
  );
  // Without this, /login's AuthRedirect bounces a stale 'authenticated'
  // status straight back (redirect ping-pong).
  expect(mockMarkAnonymous).toHaveBeenCalled();
});

it('shows the canon empty state with a catalog CTA', async () => {
  mockLoadFavorites.mockResolvedValue(readyPage([]));
  render(<FavoritesList />);
  expect(
    await screen.findByText('В избранном пока пусто'),
  ).toBeInTheDocument();
  const cta = screen.getByRole('link', { name: 'В каталог' });
  expect(cta).toHaveAttribute('href', '/');
});

it('renders reused catalog cards with slug-derived detail links', async () => {
  mockLoadFavorites.mockResolvedValue(readyPage([item(1), item(2)]));
  render(<FavoritesList />);

  expect(await screen.findByText('Кафе 1')).toBeInTheDocument();
  expect(screen.getByText('Кафе 2')).toBeInTheDocument();

  const links = screen.getAllByRole('link');
  const hrefs = links.map((l) => l.getAttribute('href'));
  expect(hrefs).toContain('/minsk/cafes/slug-1');
  expect(hrefs).toContain('/minsk/cafes/slug-2');
  // hasNext=false → no load-more control
  expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
});

it('removes a card in place when its heart is toggled off; empty state after the last one', async () => {
  mockLoadFavorites.mockResolvedValue(readyPage([item(1), item(2)]));
  mockGetFavoritesForIds.mockResolvedValue({ 'est-1': true, 'est-2': true });
  const user = userEvent.setup();
  render(<FavoritesList />);

  // Provider hydration lands: both hearts are active.
  const hearts = await screen.findAllByRole('button', {
    name: 'Убрать из избранного',
  });
  expect(hearts).toHaveLength(2);

  await user.click(hearts[0]);
  await waitFor(() => expect(screen.queryByText('Кафе 1')).toBeNull());
  expect(mockRemoveFavorite).toHaveBeenCalledWith('est-1');
  expect(screen.getByText('Кафе 2')).toBeInTheDocument();

  await user.click(
    screen.getByRole('button', { name: 'Убрать из избранного' }),
  );
  expect(await screen.findByText('В избранном пока пусто')).toBeInTheDocument();
});

it('restores the card when the remove rolls back (failed toggle)', async () => {
  mockLoadFavorites.mockResolvedValue(readyPage([item(1)]));
  mockGetFavoritesForIds.mockResolvedValue({ 'est-1': true });
  mockRemoveFavorite.mockResolvedValue({ ok: false, code: 'NETWORK' });
  const user = userEvent.setup();
  render(<FavoritesList />);

  await user.click(
    await screen.findByRole('button', { name: 'Убрать из избранного' }),
  );

  // Optimistic vanish, then rollback puts the card back.
  await waitFor(() => expect(screen.getByText('Кафе 1')).toBeInTheDocument());
});

it('appends the next page via «Показать ещё»', async () => {
  mockLoadFavorites
    .mockResolvedValueOnce(readyPage([item(1)], { page: 1, hasNext: true }))
    .mockResolvedValueOnce(readyPage([item(2)], { page: 2, hasNext: false }));
  const user = userEvent.setup();
  render(<FavoritesList />);

  await user.click(
    await screen.findByRole('button', { name: 'Показать ещё' }),
  );

  expect(await screen.findByText('Кафе 2')).toBeInTheDocument();
  expect(screen.getByText('Кафе 1')).toBeInTheDocument();
  expect(mockLoadFavorites).toHaveBeenLastCalledWith(2);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull(),
  );
});
