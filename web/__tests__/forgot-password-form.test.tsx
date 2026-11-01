/**
 * ForgotPasswordForm — what the visitor sees after pressing «Отправить
 * ссылку»: the email text, the server's refusals, the button while the
 * request is in flight, and the confirmation that replaces the form.
 *
 * Until 01.11.2026 the form was only ever rendered blank (Crapper measure,
 * docs/handoffs/crapper_measure_20261101): 12 of its 23 branches had never
 * run. Here the REAL forgotPasswordAction runs behind the form; the stub sits
 * at the API client (`serverFetch`), the boundary
 * auth-forgot-password-action.test.ts uses. A refusal is the ApiError
 * serverFetch builds from the backend's envelope (client.ts).
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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { serverFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';

const serverFetchMock = serverFetch as jest.Mock;

const SENT_RU =
  'Если такой email зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля.';

/*
 * backend authController.forgotPassword: always 200 { success:true,
 * data:{ message: AUTH_REFUSALS.passwordResetSent } } — the same sentence the
 * site keeps as its own (FORGOT_SENT_RU), whatever the email.
 */
const FORGOT_RESPONSE = {
  message:
    'Если такой email зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля.',
};

beforeEach(() => {
  jest.clearAllMocks();
  // A rejected/resolved value set by one test must not answer the next one
  // (feedback_jest_once_mocks_leak_past_clearallmocks).
  serverFetchMock.mockReset();
  mockStore.get.mockReturnValue(undefined);
});

async function submit(email: string) {
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  if (email) await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Отправить ссылку' }));
  return user;
}

describe('ForgotPasswordForm — input errors', () => {
  it('a malformed email: a text under the field, the email kept, nothing sent', async () => {
    await submit('user@test');

    const error = await screen.findByText('Введите корректный email.');
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', error.id);
    // React 19 reset the input; the echoed email repopulates it.
    expect(email).toHaveValue('user@test');
    expect(screen.queryByText('Проверьте правильность заполнения полей.')).not.toBeInTheDocument();
    expect(serverFetchMock).not.toHaveBeenCalled();
  });

  it('an empty field: the same text', async () => {
    await submit('');

    expect(await screen.findByText('Введите корректный email.')).toBeInTheDocument();
    expect(serverFetchMock).not.toHaveBeenCalled();
  });
});

describe('ForgotPasswordForm — the server refuses', () => {
  it('too many requests (429 RATE_LIMIT_EXCEEDED): «Слишком много попыток», the form stays', async () => {
    // backend middleware/rateLimiter.js: 429 { success:false, message: RATE_LIMIT_MESSAGE,
    // error:{ code:'RATE_LIMIT_EXCEEDED', details:{…} } } — serverFetch takes the HTTP status.
    serverFetchMock.mockRejectedValue(
      new ApiError(429, 'Слишком много запросов. Попробуйте позже.', 'RATE_LIMIT_EXCEEDED', {
        limit: 5,
        window: '1 hour',
        retry_after: 1800,
        reset_at: '2026-11-01T16:10:00.000Z',
      }),
    );
    await submit('user@test.by');

    expect(await screen.findByText('Слишком много попыток. Попробуйте позже.')).toBeInTheDocument();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('user@test.by');
    expect(email).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(SENT_RU)).not.toBeInTheDocument();
  });

  it('server unreachable (fetch failed — status 0): a neutral line, no confirmation', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(0, 'Fetch failed for /api/v1/auth/forgot-password: fetch failed'),
    );
    await submit('user@test.by');

    expect(
      await screen.findByText('Не удалось выполнить запрос. Попробуйте позже.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(SENT_RU)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить ссылку' })).toBeEnabled();
  });
});

describe('ForgotPasswordForm — while the request is in flight', () => {
  it('the button says «Отправляем…» and cannot be pressed again', async () => {
    let answer!: () => void;
    serverFetchMock.mockReturnValue(
      new Promise((resolve) => {
        answer = () => resolve(FORGOT_RESPONSE);
      }),
    );
    await submit('user@test.by');

    // The answer comes even if an assertion fails: React holds every later
    // form action behind a pending one (see login-form.test.tsx).
    try {
      const busy = await screen.findByRole('button', { name: 'Отправляем…' });
      expect(busy).toBeDisabled();
      expect(serverFetchMock).toHaveBeenCalledTimes(1);
    } finally {
      answer();
    }

    expect(await screen.findByText(SENT_RU)).toBeInTheDocument();
  });
});

describe('ForgotPasswordForm — success', () => {
  it('the form gives way to one fixed confirmation that does not say whether the email exists', async () => {
    serverFetchMock.mockResolvedValue(FORGOT_RESPONSE);
    await submit('user@test.by');

    const confirmation = await screen.findByText(SENT_RU);
    expect(confirmation).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(serverFetchMock).toHaveBeenCalledTimes(1);
  });
});
