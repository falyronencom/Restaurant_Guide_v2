/**
 * FavoritesProvider — client batch-load (ISR-preserving variant of DECISION #4),
 * optimistic toggle + rollback, and the unauthenticated-tap → login prompt path.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRequestLogin = jest.fn();
const mockAuth: {
  current: { status: string; isAuthenticated: boolean; requestLogin: () => void };
} = {
  current: {
    status: 'authenticated',
    isAuthenticated: true,
    requestLogin: mockRequestLogin,
  },
};

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => mockAuth.current,
}));
jest.mock('@/lib/favorites/actions', () => ({
  getFavoritesForIds: jest.fn(),
  addFavoriteAction: jest.fn(),
  removeFavoriteAction: jest.fn(),
}));

import {
  FavoritesProvider,
  useFavorites,
} from '@/components/favorites/FavoritesProvider';
import {
  addFavoriteAction,
  getFavoritesForIds,
  removeFavoriteAction,
} from '@/lib/favorites/actions';

function Probe({ id }: { id: string }) {
  const { isFavorite, toggle } = useFavorites();
  return (
    <button
      type="button"
      onClick={() => void toggle(id)}
      aria-pressed={isFavorite(id)}
    >
      {id}
    </button>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.current = {
    status: 'authenticated',
    isAuthenticated: true,
    requestLogin: mockRequestLogin,
  };
});

it('batch-loads favorite state once authenticated', async () => {
  (getFavoritesForIds as jest.Mock).mockResolvedValue({ e1: true, e2: false });

  render(
    <FavoritesProvider establishmentIds={['e1', 'e2']}>
      <Probe id="e1" />
      <Probe id="e2" />
    </FavoritesProvider>,
  );

  expect(getFavoritesForIds).toHaveBeenCalledWith(['e1', 'e2']);
  await waitFor(() =>
    expect(screen.getByText('e1')).toHaveAttribute('aria-pressed', 'true'),
  );
  expect(screen.getByText('e2')).toHaveAttribute('aria-pressed', 'false');
});

it('does NOT batch-load for an anonymous visitor', () => {
  mockAuth.current = {
    status: 'anonymous',
    isAuthenticated: false,
    requestLogin: mockRequestLogin,
  };

  render(
    <FavoritesProvider establishmentIds={['e1']}>
      <Probe id="e1" />
    </FavoritesProvider>,
  );

  expect(getFavoritesForIds).not.toHaveBeenCalled();
});

it('optimistically toggles and persists via addFavoriteAction', async () => {
  (getFavoritesForIds as jest.Mock).mockResolvedValue({ e1: false });
  (addFavoriteAction as jest.Mock).mockResolvedValue({
    ok: true,
    isFavorite: true,
  });

  render(
    <FavoritesProvider establishmentIds={['e1']}>
      <Probe id="e1" />
    </FavoritesProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText('e1')).toHaveAttribute('aria-pressed', 'false'),
  );

  await userEvent.click(screen.getByText('e1'));

  expect(addFavoriteAction).toHaveBeenCalledWith('e1');
  await waitFor(() =>
    expect(screen.getByText('e1')).toHaveAttribute('aria-pressed', 'true'),
  );
});

it('rolls back the optimistic toggle when the mutation fails', async () => {
  (getFavoritesForIds as jest.Mock).mockResolvedValue({ e1: false });
  (addFavoriteAction as jest.Mock).mockResolvedValue({
    ok: false,
    code: 'NETWORK',
  });

  render(
    <FavoritesProvider establishmentIds={['e1']}>
      <Probe id="e1" />
    </FavoritesProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText('e1')).toHaveAttribute('aria-pressed', 'false'),
  );

  await userEvent.click(screen.getByText('e1'));
  await waitFor(() => expect(addFavoriteAction).toHaveBeenCalled());
  // Reverted to false after the failed mutation.
  await waitFor(() =>
    expect(screen.getByText('e1')).toHaveAttribute('aria-pressed', 'false'),
  );
});

it('toggles a favorited card off via removeFavoriteAction', async () => {
  (getFavoritesForIds as jest.Mock).mockResolvedValue({ e1: true });
  (removeFavoriteAction as jest.Mock).mockResolvedValue({
    ok: true,
    isFavorite: false,
  });

  render(
    <FavoritesProvider establishmentIds={['e1']}>
      <Probe id="e1" />
    </FavoritesProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText('e1')).toHaveAttribute('aria-pressed', 'true'),
  );

  await userEvent.click(screen.getByText('e1'));

  expect(removeFavoriteAction).toHaveBeenCalledWith('e1');
  await waitFor(() =>
    expect(screen.getByText('e1')).toHaveAttribute('aria-pressed', 'false'),
  );
});

it('prompts login on an unauthenticated tap instead of mutating', async () => {
  mockAuth.current = {
    status: 'anonymous',
    isAuthenticated: false,
    requestLogin: mockRequestLogin,
  };

  render(
    <FavoritesProvider establishmentIds={['e1']}>
      <Probe id="e1" />
    </FavoritesProvider>,
  );

  await userEvent.click(screen.getByText('e1'));

  expect(mockRequestLogin).toHaveBeenCalled();
  expect(addFavoriteAction).not.toHaveBeenCalled();
});
