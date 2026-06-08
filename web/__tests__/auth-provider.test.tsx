/**
 * AuthProvider client island — hydration from getSessionSummary + logout flow.
 * Mirrors the open-status-badge.test.tsx client-island pattern (render flushes
 * mount effects via act; assert post-mount state).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock('@/lib/auth/actions', () => ({
  getSessionSummary: jest.fn(),
  logoutAction: jest.fn(),
  establishGoogleSession: jest.fn(),
  prepareLogin: jest.fn(),
}));

import { AuthProvider, useAuth } from '@/components/auth/AuthProvider';
import { getSessionSummary, logoutAction } from '@/lib/auth/actions';

function Probe() {
  const { status, user, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.name ?? 'none'}</span>
      <button type="button" onClick={() => void logout()}>
        выйти
      </button>
    </div>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('hydrates to authenticated from getSessionSummary on mount', async () => {
  (getSessionSummary as jest.Mock).mockResolvedValue({
    id: 'u1',
    name: 'Аня',
    email: 'a@b.co',
    role: 'user',
    avatarUrl: null,
  });

  render(
    <AuthProvider googleClientId="cid">
      <Probe />
    </AuthProvider>,
  );

  expect(await screen.findByText('Аня')).toBeInTheDocument();
  expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
});

it('hydrates to anonymous when there is no session', async () => {
  (getSessionSummary as jest.Mock).mockResolvedValue(null);

  render(
    <AuthProvider googleClientId="cid">
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
  );
});

it('logout calls logoutAction and flips to anonymous', async () => {
  (getSessionSummary as jest.Mock).mockResolvedValue({
    id: 'u1',
    name: 'Аня',
    email: 'a@b.co',
    role: 'user',
    avatarUrl: null,
  });
  (logoutAction as jest.Mock).mockResolvedValue(undefined);

  render(
    <AuthProvider googleClientId="cid">
      <Probe />
    </AuthProvider>,
  );
  await screen.findByText('Аня');

  await userEvent.click(screen.getByRole('button', { name: 'выйти' }));

  expect(logoutAction).toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByTestId('user')).toHaveTextContent('none'),
  );
});
