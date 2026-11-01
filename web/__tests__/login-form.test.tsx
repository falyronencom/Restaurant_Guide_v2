/**
 * LoginForm — what the visitor sees after pressing «Войти»: the per-field
 * texts, the server's refusals, the button while the request is in flight,
 * and the session handed to the header on success.
 *
 * Until 01.11.2026 the form was only ever rendered blank (Crapper measure,
 * docs/handoffs/crapper_measure_20261101): 14 of its 29 branches had never
 * run. Here the REAL loginAction runs behind the form; the stub sits at the
 * API client (`serverFetch`), the boundary auth-login-action.test.ts uses.
 * A refusal is the ApiError serverFetch builds from the backend's envelope
 * (client.ts: statusCode, then `error.message ?? message`, `error.code`,
 * `error.details`) — the envelopes below are copied from the backend and
 * cited where they are built.
 */
const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
};

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockStore)),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

/*
 * One stable context object: LoginForm's success effect lists applySession in
 * its deps, and a fresh object per render would re-run it on every commit.
 */
const mockApplySession = jest.fn();
const mockAuth = { applySession: mockApplySession };
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LoginForm } from '@/components/auth/LoginForm';
import { serverFetch } from '@/lib/api/client';
import { ApiError, type LoginData } from '@/lib/api/types';

const serverFetchMock = serverFetch as jest.Mock;

const LOGIN_RESPONSE: LoginData = {
  user: {
    id: 'u-1',
    email: 'user@test.by',
    phone: null,
    name: 'Иван',
    role: 'user',
    authMethod: 'email',
    avatarUrl: null,
    lastLoginAt: '2026-11-01T08:00:00.000Z',
  },
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

beforeEach(() => {
  jest.clearAllMocks();
  // A rejected/resolved value set by one test must not answer the next one
  // (feedback_jest_once_mocks_leak_past_clearallmocks).
  serverFetchMock.mockReset();
  mockStore.get.mockReturnValue(undefined);
});

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  render(<LoginForm returnTo="/minsk" />);
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Пароль'), password);
  await user.click(screen.getByRole('button', { name: 'Войти' }));
  return user;
}

describe('LoginForm — input errors (checked before the server is asked)', () => {
  it('a malformed email and an empty password: a text under each field, the email kept', async () => {
    await submit('user@test', '');

    const emailError = await screen.findByText('Введите корректный email.');
    const passwordError = screen.getByText('Введите пароль.');

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Пароль');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', emailError.id);
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', passwordError.id);
    // React 19 reset the inputs; the echoed email repopulates its field.
    expect(email).toHaveValue('user@test');
    expect(password).toHaveValue('');
    // Field texts are enough — no summary line on top of them.
    expect(screen.queryByText('Проверьте правильность заполнения полей.')).not.toBeInTheDocument();
    expect(serverFetchMock).not.toHaveBeenCalled();
    expect(mockApplySession).not.toHaveBeenCalled();
  });

  it('only the password missing: the email field stays clean', async () => {
    await submit('user@test.by', '');

    await screen.findByText('Введите пароль.');
    const email = screen.getByLabelText('Email');
    expect(email).not.toHaveAttribute('aria-invalid');
    expect(email).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Введите корректный email.')).not.toBeInTheDocument();
  });
});

describe('LoginForm — the server refuses', () => {
  it('wrong password (401 INVALID_CREDENTIALS): one line that does not say which part was wrong', async () => {
    // backend authController.login: 401 { success:false, error:{ code:'INVALID_CREDENTIALS',
    // message: AUTH_REFUSALS.invalidCredentials } }.
    serverFetchMock.mockRejectedValue(
      new ApiError(401, 'Неверный email/телефон или пароль.', 'INVALID_CREDENTIALS'),
    );
    await submit('user@test.by', 'Wrong123');

    expect(await screen.findByText('Неверный email или пароль.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('user@test.by');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Пароль')).not.toHaveAttribute('aria-invalid');
    expect(mockApplySession).not.toHaveBeenCalled();
  });

  it('too many attempts (429 RATE_LIMIT_EXCEEDED): «Слишком много попыток»', async () => {
    // backend middleware/rateLimiter.js: 429 { success:false, message: RATE_LIMIT_MESSAGE,
    // error:{ code:'RATE_LIMIT_EXCEEDED', details:{ limit, window, retry_after, reset_at } } }
    // — no error.statusCode, no error.message: serverFetch takes the HTTP status and the
    // top-level message.
    serverFetchMock.mockRejectedValue(
      new ApiError(429, 'Слишком много запросов. Попробуйте позже.', 'RATE_LIMIT_EXCEEDED', {
        limit: 10,
        window: '1 minute',
        retry_after: 42,
        reset_at: '2026-11-01T15:41:00.000Z',
      }),
    );
    await submit('user@test.by', 'Passw0rd');

    expect(await screen.findByText('Слишком много попыток. Попробуйте позже.')).toBeInTheDocument();
    expect(mockApplySession).not.toHaveBeenCalled();
  });

  it('server unreachable (fetch failed — serverFetch status 0): a neutral line, no «войдите»', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(0, 'Fetch failed for /api/v1/auth/login: fetch failed'),
    );
    await submit('user@test.by', 'Passw0rd');

    expect(
      await screen.findByText('Не удалось выполнить запрос. Попробуйте позже.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('user@test.by');
  });

  it('server down behind the edge (502 page, not JSON): the same neutral line', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(502, 'Non-JSON response from /api/v1/auth/login (status 502)'),
    );
    await submit('user@test.by', 'Passw0rd');

    expect(
      await screen.findByText('Не удалось выполнить запрос. Попробуйте позже.'),
    ).toBeInTheDocument();
  });
});

describe('LoginForm — while the request is in flight', () => {
  it('the button says «Входим…» and cannot be pressed again; it comes back after the answer', async () => {
    let answer!: (value: unknown) => void;
    serverFetchMock.mockReturnValue(
      new Promise((resolve, reject) => {
        answer = () =>
          reject(new ApiError(401, 'Неверный email/телефон или пароль.', 'INVALID_CREDENTIALS'));
      }),
    );
    await submit('user@test.by', 'Passw0rd');

    // The answer comes even if an assertion fails: React holds every later
    // form action behind a pending one, and a request left hanging here
    // would turn the next test red for no fault of its own.
    try {
      const busy = await screen.findByRole('button', { name: 'Входим…' });
      expect(busy).toBeDisabled();
      expect(serverFetchMock).toHaveBeenCalledTimes(1);
    } finally {
      answer(undefined);
    }

    const idle = await screen.findByRole('button', { name: 'Войти' });
    expect(idle).toBeEnabled();
    expect(screen.getByText('Неверный email или пароль.')).toBeInTheDocument();
  });
});

describe('LoginForm — success', () => {
  it('hands the signed-in user to the header (AuthRedirect then leaves the page); no error shown', async () => {
    serverFetchMock.mockResolvedValue(LOGIN_RESPONSE);
    await submit('user@test.by', 'Passw0rd');

    await waitFor(() => expect(mockApplySession).toHaveBeenCalledTimes(1));
    // Display-safe summary only — no tokens reach the client context.
    expect(mockApplySession).toHaveBeenCalledWith({
      id: 'u-1',
      email: 'user@test.by',
      name: 'Иван',
      role: 'user',
      avatarUrl: null,
    });
    expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled();
    expect(screen.queryByText(/Не удалось|Неверный|Введите/)).not.toBeInTheDocument();
  });
});
