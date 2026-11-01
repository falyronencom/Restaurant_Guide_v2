/**
 * RegisterForm — what the visitor sees after pressing «Зарегистрироваться»:
 * the per-field texts (the password hint turning into the requirement), the
 * server's refusals, the button while the request is in flight, and the move
 * to the email-code screen on success.
 *
 * Until 01.11.2026 the form was only ever rendered blank (Crapper measure,
 * docs/handoffs/crapper_measure_20261101): 17 of its 35 branches had never
 * run. Here the REAL registerAction runs behind the form; the stub sits at
 * the API client (`serverFetch`), the boundary auth-register-action.test.ts
 * uses. A refusal is the ApiError serverFetch builds from the backend's
 * envelope (client.ts: statusCode, then `error.message ?? message`,
 * `error.code`, `error.details`); the envelopes are cited where the backend
 * builds them.
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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RegisterForm } from '@/components/auth/RegisterForm';
import { serverFetch } from '@/lib/api/client';
import { ApiError, type RegisterData } from '@/lib/api/types';

const serverFetchMock = serverFetch as jest.Mock;

const REGISTER_RESPONSE: RegisterData = {
  user: {
    id: 'u-new',
    email: 'new@test.by',
    phone: null,
    name: 'Анна',
    role: 'user',
    authMethod: 'email',
    createdAt: '2026-11-01T08:00:00.000Z',
  },
  accessToken: 'access-new',
  refreshToken: 'refresh-new',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

const PASSWORD_HINT_RU = 'Минимум 8 символов, заглавная и строчная буквы, цифра.';
const PASSWORD_RULE_RU = 'Пароль: минимум 8 символов, заглавная и строчная буквы, цифра.';

/*
 * The success path leaves the page with window.location.assign — a hard load
 * on purpose (RegisterForm's header comment). jsdom implements no navigation
 * and its Location is unforgeable (spyOn / defineProperty / delete all fail),
 * so the call is caught on the Location's implementation object, the one
 * place jsdom lets it be replaced. If a jsdom upgrade moves it, the guard
 * below fails loudly instead of the success test passing blind.
 */
function captureHardNavigation(): jest.Mock {
  const location = window.location as unknown as Record<symbol, Record<string, unknown>>;
  const implKey = Object.getOwnPropertySymbols(location).find(
    (s) => s.description === 'impl',
  );
  if (!implKey) throw new Error('jsdom Location implementation not found');
  const assign = jest.fn();
  location[implKey].assign = assign;
  return assign;
}

function releaseHardNavigation() {
  const location = window.location as unknown as Record<symbol, Record<string, unknown>>;
  const implKey = Object.getOwnPropertySymbols(location).find(
    (s) => s.description === 'impl',
  );
  if (implKey) delete location[implKey].assign;
}

let assignMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // A rejected/resolved value set by one test must not answer the next one
  // (feedback_jest_once_mocks_leak_past_clearallmocks).
  serverFetchMock.mockReset();
  mockStore.get.mockReturnValue(undefined);
  assignMock = captureHardNavigation();
});

afterEach(() => {
  releaseHardNavigation();
});

it('fixture guard: a hard navigation is caught with its address', () => {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the guard calls the same API the form uses
  window.location.assign('/verify-email?returnTo=%2Fminsk');
  expect(assignMock).toHaveBeenCalledWith('/verify-email?returnTo=%2Fminsk');
});

async function submit(
  fields: { name?: string; email?: string; password?: string },
  returnTo = '/minsk',
) {
  const user = userEvent.setup();
  render(<RegisterForm returnTo={returnTo} />);
  if (fields.name) await user.type(screen.getByLabelText('Имя'), fields.name);
  if (fields.email) await user.type(screen.getByLabelText('Email'), fields.email);
  if (fields.password) await user.type(screen.getByLabelText('Пароль'), fields.password);
  await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
  return user;
}

const VALID = { name: 'Анна', email: 'new@test.by', password: 'Passw0rd' };

describe('RegisterForm — before anything is sent', () => {
  it('the password hint is grey and the field points at it', () => {
    render(<RegisterForm returnTo="/" />);

    const hint = screen.getByText(PASSWORD_HINT_RU);
    expect(hint).toHaveClass('text-figma-text-dark');
    expect(hint).not.toHaveClass('text-destructive');
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('aria-describedby', hint.id);
  });
});

describe('RegisterForm — input errors (checked before the server is asked)', () => {
  it('a bad name, email and password: a text under each, the hint turns into the rule, name and email kept', async () => {
    await submit({ name: 'Анна2', email: 'new@test', password: 'password' });

    const nameError = await screen.findByText(
      'Имя: от 2 до 50 символов — только буквы, пробел, дефис и апостроф.',
    );
    const emailError = screen.getByText('Введите корректный email.');
    const rule = screen.getByText(PASSWORD_RULE_RU);

    const name = screen.getByLabelText('Имя');
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Пароль');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', nameError.id);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', emailError.id);
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', rule.id);
    // The hint's place now carries the requirement, in red.
    expect(rule).toHaveClass('text-destructive');
    expect(screen.queryByText(PASSWORD_HINT_RU)).not.toBeInTheDocument();
    // React 19 reset the inputs; name and email come back, the password never does.
    expect(name).toHaveValue('Анна2');
    expect(email).toHaveValue('new@test');
    expect(password).toHaveValue('');
    expect(screen.queryByText('Проверьте правильность заполнения полей.')).not.toBeInTheDocument();
    expect(serverFetchMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('only the password weak: name and email stay clean, the hint is replaced', async () => {
    await submit({ name: 'Анна', email: 'new@test.by', password: 'short' });

    expect(await screen.findByText(PASSWORD_RULE_RU)).toBeInTheDocument();
    for (const label of ['Имя', 'Email']) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-invalid');
      expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-describedby');
    }
  });
});

describe('RegisterForm — the server refuses', () => {
  it('the email is taken (409 EMAIL_EXISTS): «уже зарегистрирован», with a hint to sign in', async () => {
    // backend authController.register: 409 { success:false, error:{ code:'EMAIL_EXISTS',
    // message: AUTH_REFUSALS.emailExists } }.
    serverFetchMock.mockRejectedValue(
      new ApiError(409, 'Этот email уже зарегистрирован. Попробуйте войти.', 'EMAIL_EXISTS'),
    );
    await submit(VALID);

    expect(
      await screen.findByText('Этот email уже зарегистрирован. Попробуйте войти.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Имя')).toHaveValue('Анна');
    expect(screen.getByLabelText('Email')).toHaveValue('new@test.by');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('the server rejects the name (422, its own Russian words): shown under the name as is', async () => {
    // backend validators/authValidation.js handleValidationErrors: 422 { success:false,
    // error:{ code:'VALIDATION_ERROR', message: <first Russian text> ?? 'Invalid input data',
    // details:{ <field>: [messages] } } }; the name refusal is utils/userName.js NAME_REFUSALS.
    serverFetchMock.mockRejectedValue(
      new ApiError(422, 'Имя содержит недопустимые слова', 'VALIDATION_ERROR', {
        name: ['Имя содержит недопустимые слова'],
      }),
    );
    await submit(VALID);

    const nameError = await screen.findByText('Имя содержит недопустимые слова');
    expect(screen.getByLabelText('Имя')).toHaveAttribute('aria-describedby', nameError.id);
    expect(screen.getByLabelText('Имя')).toHaveAttribute('aria-invalid', 'true');
    // Field texts carry it — the summary line stays empty.
    expect(screen.queryByText('Проверьте правильность заполнения полей.')).not.toBeInTheDocument();
  });

  it('the server rejects an email the site let through (422, English): the site\'s own words under the field', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(422, 'Invalid input data', 'VALIDATION_ERROR', {
        email: ['Invalid email format'],
      }),
    );
    await submit({ ...VALID, email: 'new@test.b' });

    expect(await screen.findByText('Введите корректный email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Invalid email format')).not.toBeInTheDocument();
  });

  it('too many attempts (429 RATE_LIMIT_EXCEEDED): «Слишком много попыток»', async () => {
    // backend middleware/rateLimiter.js: 429, top-level message, error.code only.
    serverFetchMock.mockRejectedValue(
      new ApiError(429, 'Слишком много запросов. Попробуйте позже.', 'RATE_LIMIT_EXCEEDED', {
        limit: 20,
        window: '1 minute',
        retry_after: 30,
        reset_at: '2026-11-01T15:41:00.000Z',
      }),
    );
    await submit(VALID);

    expect(await screen.findByText('Слишком много попыток. Попробуйте позже.')).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('server unreachable (fetch failed — status 0): a neutral line that does not say «войти»', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(0, 'Fetch failed for /api/v1/auth/register: fetch failed'),
    );
    await submit(VALID);

    expect(
      await screen.findByText('Не удалось выполнить запрос. Попробуйте позже.'),
    ).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('server error (500 INTERNAL_ERROR): the same neutral line', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(500, 'Internal server error', 'INTERNAL_ERROR'),
    );
    await submit(VALID);

    expect(
      await screen.findByText('Не удалось выполнить запрос. Попробуйте позже.'),
    ).toBeInTheDocument();
  });
});

describe('RegisterForm — while the request is in flight', () => {
  it('the button says «Создаём учётную запись…» and cannot be pressed again', async () => {
    let answer!: () => void;
    serverFetchMock.mockReturnValue(
      new Promise((resolve, reject) => {
        answer = () =>
          reject(new ApiError(409, 'Этот email уже зарегистрирован. Попробуйте войти.', 'EMAIL_EXISTS'));
      }),
    );
    await submit(VALID);

    // The answer comes even if an assertion fails: React holds every later
    // form action behind a pending one (see login-form.test.tsx).
    try {
      const busy = await screen.findByRole('button', { name: 'Создаём учётную запись…' });
      expect(busy).toBeDisabled();
      expect(serverFetchMock).toHaveBeenCalledTimes(1);
    } finally {
      answer();
    }

    expect(await screen.findByRole('button', { name: 'Зарегистрироваться' })).toBeEnabled();
  });
});

describe('RegisterForm — success', () => {
  it('goes on to the email-code screen with a full page load, carrying where the visitor came from', async () => {
    serverFetchMock.mockResolvedValue(REGISTER_RESPONSE);
    await submit(VALID, '/minsk/restaurants');

    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock).toHaveBeenCalledWith('/verify-email?returnTo=%2Fminsk%2Frestaurants');
    expect(screen.queryByText(/Не удалось|Слишком|уже зарегистрирован/)).not.toBeInTheDocument();
  });

  it('came from the home page: the email-code screen without a way back in the address', async () => {
    serverFetchMock.mockResolvedValue(REGISTER_RESPONSE);
    await submit(VALID, '/');

    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock).toHaveBeenCalledWith('/verify-email');
  });
});
