/**
 * ProfileHub island — loads the fresh /auth/me user via the account client,
 * guards anon (NO_SESSION → /login?returnTo=/profile), renders the hub rows
 * (editable name, email + verification badge, password entry, logout) and
 * syncs AuthProvider via applySession after a successful save. The account
 * client and useAuth are mocked.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { AuthUserData } from '@/lib/api/types';

const mockReplace = jest.fn();
// Stable identity, mirroring the real useRouter — the island's effect depends
// on [router]; a per-render object would re-run it in a loop.
const mockRouter = { replace: mockReplace, push: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/profile',
}));
jest.mock('@/lib/account/client', () => ({
  loadProfile: jest.fn(),
  updateProfileAction: jest.fn(),
}));
const mockApplySession = jest.fn();
const mockLogout = jest.fn();
const mockMarkAnonymous = jest.fn();
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    isAuthenticated: true,
    user: null,
    requestLogin: jest.fn(),
    logout: mockLogout,
    loginError: null,
    applySession: mockApplySession,
    markAnonymous: mockMarkAnonymous,
  }),
}));

import { loadProfile, updateProfileAction } from '@/lib/account/client';
import { ProfileHub } from '@/components/account/ProfileHub';

const mockLoadProfile = loadProfile as jest.Mock;
const mockUpdateProfile = updateProfileAction as jest.Mock;

function profile(overrides: Partial<AuthUserData> = {}): AuthUserData {
  return {
    id: 'u1',
    email: 'v@example.by',
    phone: null,
    name: 'Всеволод',
    role: 'user',
    authMethod: 'email',
    avatarUrl: null,
    emailVerified: false,
    phoneVerified: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLogout.mockResolvedValue(undefined);
});

it('redirects an anonymous visitor to /login with returnTo, syncing the auth context first', async () => {
  mockLoadProfile.mockResolvedValue({ ok: false, code: 'NO_SESSION' });
  render(<ProfileHub />);
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/login?returnTo=/profile'),
  );
  // Without this, /login's AuthRedirect bounces a stale 'authenticated'
  // status straight back (redirect ping-pong).
  expect(mockMarkAnonymous).toHaveBeenCalled();
});

it('renders the hub for an unverified email account', async () => {
  mockLoadProfile.mockResolvedValue({ ok: true, profile: profile() });
  render(<ProfileHub />);

  expect(await screen.findByLabelText('Имя')).toHaveValue('Всеволод');
  expect(screen.getByText('v@example.by')).toBeInTheDocument();
  expect(screen.getByText('Не подтверждён')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Подтвердить' })).toHaveAttribute(
    'href',
    '/verify-email',
  );
  expect(
    screen.getByRole('link', { name: 'Сменить пароль' }),
  ).toHaveAttribute('href', '/forgot-password');
  // Save is idle until the name actually changes.
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
});

it('shows the verified badge without the verify link', async () => {
  mockLoadProfile.mockResolvedValue({
    ok: true,
    profile: profile({ emailVerified: true }),
  });
  render(<ProfileHub />);

  expect(await screen.findByText('Подтверждён')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Подтвердить' })).toBeNull();
});

it('hides the password entry for an OAuth account', async () => {
  mockLoadProfile.mockResolvedValue({
    ok: true,
    profile: profile({ authMethod: 'google' }),
  });
  render(<ProfileHub />);

  expect(
    await screen.findByText(/Вход через Google — пароль не используется/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Сменить пароль' })).toBeNull();
});

it('saves a trimmed name and syncs AuthProvider via applySession', async () => {
  mockLoadProfile.mockResolvedValue({ ok: true, profile: profile() });
  const savedUser = {
    id: 'u1',
    email: 'v@example.by',
    name: 'Новое имя',
    role: 'user',
    avatarUrl: null,
  };
  mockUpdateProfile.mockResolvedValue({ ok: true, user: savedUser });
  const user = userEvent.setup();
  render(<ProfileHub />);

  const input = await screen.findByLabelText('Имя');
  await user.clear(input);
  await user.type(input, '  Новое имя  ');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));

  await waitFor(() =>
    expect(mockUpdateProfile).toHaveBeenCalledWith('Новое имя'),
  );
  expect(mockApplySession).toHaveBeenCalledWith(savedUser);
  expect(await screen.findByText('Сохранено.')).toBeInTheDocument();
});

it('surfaces a russified error on a failed save', async () => {
  mockLoadProfile.mockResolvedValue({ ok: true, profile: profile() });
  mockUpdateProfile.mockResolvedValue({
    ok: false,
    code: 'VALIDATION_ERROR',
  });
  const user = userEvent.setup();
  render(<ProfileHub />);

  const input = await screen.findByLabelText('Имя');
  await user.clear(input);
  await user.type(input, 'Другое имя');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));

  expect(
    await screen.findByText('Имя должно быть от 1 до 100 символов.'),
  ).toBeInTheDocument();
  expect(mockApplySession).not.toHaveBeenCalled();
});

it('logs out and navigates home', async () => {
  mockLoadProfile.mockResolvedValue({ ok: true, profile: profile() });
  const user = userEvent.setup();
  render(<ProfileHub />);

  await user.click(await screen.findByRole('button', { name: 'Выйти' }));

  await waitFor(() => expect(mockLogout).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
});
