/**
 * requestLogin({ fallbackToLoginPage: true }) — a guest's tap on the heart or
 * «Оставить отзыв» (сверка находок тестировщика с сайтом, 18.10, Х2).
 *
 * Both only open Google's One Tap. When Google cannot sign the guest in on the
 * spot — not configured, script not loaded, the prompt not shown — the tap
 * looked dead and the reason was shown nowhere (only /login renders
 * loginError). Now the guest goes to /login with a way back to this page, and
 * the reason waits there under the buttons. A guest who closed the prompt
 * themselves is left alone; a call without the option (the /login button
 * itself) never navigates.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, refresh: jest.fn() };
jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/auth/actions', () => ({
  getSessionSummary: jest.fn(() => Promise.resolve(null)),
  logoutAction: jest.fn(),
  establishGoogleSession: jest.fn(),
  prepareLogin: jest.fn(() => Promise.resolve({ nonce: 'n' })),
}));

import { AuthProvider, useAuth } from '@/components/auth/AuthProvider';

function Probe({ fallback }: { fallback: boolean }) {
  const { requestLogin, loginError } = useAuth();
  return (
    <div>
      <span data-testid="error">{loginError ?? ''}</span>
      <button
        type="button"
        onClick={() =>
          fallback ? requestLogin({ fallbackToLoginPage: true }) : requestLogin()
        }
      >
        войти
      </button>
    </div>
  );
}

type Notification = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  getSkippedReason?: () => string;
};

function withGoogle(notification: Notification) {
  window.google = {
    accounts: {
      id: {
        initialize: jest.fn(),
        prompt: (listener?: (n: Notification) => void) => listener?.(notification),
        cancel: jest.fn(),
      },
    },
  };
}

const CARD = '/minsk/restaurants/kafe-1?from=list';
const LOGIN_BACK = `/login?returnTo=${encodeURIComponent(CARD)}`;
const NOT_SHOWN =
  'Окно входа Google не открылось. Войдите по почте или через Яндекс.';

beforeEach(() => {
  jest.clearAllMocks();
  delete window.google;
  window.history.pushState({}, '', CARD);
});

it('Google not configured → /login with the way back, and the reason', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <AuthProvider googleClientId={null}>
      <Probe fallback />
    </AuthProvider>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'войти' }));

  expect(mockPush).toHaveBeenCalledWith(LOGIN_BACK);
  expect(screen.getByTestId('error')).toHaveTextContent(
    'Вход через Google временно недоступен.',
  );
  (console.error as jest.Mock).mockRestore();
});

it('the prompt was not shown → /login with the way back', async () => {
  withGoogle({ isNotDisplayed: () => true });
  render(
    <AuthProvider googleClientId="cid">
      <Probe fallback />
    </AuthProvider>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'войти' }));

  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(LOGIN_BACK));
  expect(screen.getByTestId('error')).toHaveTextContent(NOT_SHOWN);
});

it('Google skipped the prompt on its own (FedCM: skipped, not by the user) → /login', async () => {
  withGoogle({ isSkippedMoment: () => true, getSkippedReason: () => 'issuing_failed' });
  render(
    <AuthProvider googleClientId="cid">
      <Probe fallback />
    </AuthProvider>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'войти' }));

  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(LOGIN_BACK));
});

it('the guest closed the prompt themselves → stays here, no error', async () => {
  withGoogle({ isSkippedMoment: () => true, getSkippedReason: () => 'user_cancel' });
  render(
    <AuthProvider googleClientId="cid">
      <Probe fallback />
    </AuthProvider>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'войти' }));

  await new Promise((r) => setTimeout(r, 20));
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.getByTestId('error')).toHaveTextContent('');
});

it('on the home page /login carries no returnTo', async () => {
  window.history.pushState({}, '', '/');
  withGoogle({ isNotDisplayed: () => true });
  render(
    <AuthProvider googleClientId="cid">
      <Probe fallback />
    </AuthProvider>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'войти' }));

  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
});

it('without the option (the /login button itself) it never navigates — the reason shows in place', async () => {
  withGoogle({ isNotDisplayed: () => true });
  render(
    <AuthProvider googleClientId="cid">
      <Probe fallback={false} />
    </AuthProvider>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'войти' }));

  await waitFor(() =>
    expect(screen.getByTestId('error')).toHaveTextContent(NOT_SHOWN),
  );
  expect(mockPush).not.toHaveBeenCalled();
});
