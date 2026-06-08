/**
 * FavoriteButton island — render state + aria + tap delegation. The toggle
 * behaviour (optimistic / rollback / unauth-prompt) lives in FavoritesProvider
 * and is covered in favorites-provider.test.tsx; here useFavorites is mocked.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockToggle = jest.fn();
const mockIsFavorite = jest.fn();

jest.mock('@/components/favorites/FavoritesProvider', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggle: mockToggle }),
}));

import { FavoriteButton } from '@/components/favorites/FavoriteButton';

beforeEach(() => {
  jest.clearAllMocks();
});

it('renders the inactive (outline) state with the "add" aria-label', () => {
  mockIsFavorite.mockReturnValue(false);
  render(<FavoriteButton establishmentId="e1" />);
  const button = screen.getByRole('button', { name: 'В избранное' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
});

it('renders the active state with the "remove" aria-label when favorited', () => {
  mockIsFavorite.mockReturnValue(true);
  render(<FavoriteButton establishmentId="e1" />);
  expect(
    screen.getByRole('button', { name: 'Убрать из избранного' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

it('delegates a tap to toggle(establishmentId)', async () => {
  mockIsFavorite.mockReturnValue(false);
  render(<FavoriteButton establishmentId="e1" />);
  await userEvent.click(screen.getByRole('button'));
  expect(mockToggle).toHaveBeenCalledWith('e1');
});
