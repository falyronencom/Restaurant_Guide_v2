/**
 * loginAction (Slice 2) — credential exchange through the unchanged
 * persistOAuthSession (login response is field-for-field the OAuth shape),
 * generic anti-enumeration 401 mapping, 429 mapping. Same mock boundary as
 * auth-register-action.test.ts.
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

import { serverFetch } from '@/lib/api/client';
import { ApiError, type LoginData } from '@/lib/api/types';
import { loginAction } from '@/lib/auth/actions';

const serverFetchMock = serverFetch as jest.Mock;

const LOGIN_RESPONSE: LoginData = {
  user: {
    id: 'u-1',
    email: 'user@test.by',
    phone: null,
    name: 'Иван',
    role: 'user',
    authMethod: 'email',
    avatarUrl: 'https://cdn.example/a.jpg',
    lastLoginAt: '2026-06-10T08:00:00.000Z',
  },
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID_FIELDS = {
  email: 'user@test.by',
  password: 'Passw0rd',
  returnTo: '/minsk',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockReturnValue(undefined);
});

describe('loginAction — success', () => {
  it('POSTs credentials, persists via the shared path (avatarUrl preserved), returns returnTo', async () => {
    serverFetchMock.mockResolvedValue(LOGIN_RESPONSE);

    const result = await loginAction(null, formDataOf(VALID_FIELDS));

    expect(serverFetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (serverFetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toEqual({ email: 'user@test.by', password: 'Passw0rd' });

    expect(result).toEqual({
      ok: true,
      returnTo: '/minsk',
      user: {
        id: 'u-1',
        email: 'user@test.by',
        name: 'Иван',
        role: 'user',
        avatarUrl: 'https://cdn.example/a.jpg',
      },
    });
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_at',
      'access-2',
      expect.objectContaining({ httpOnly: true, maxAge: 14400 }),
    );
  });

  it('collapses an unsafe returnTo to /', async () => {
    serverFetchMock.mockResolvedValue(LOGIN_RESPONSE);

    const result = await loginAction(
      null,
      formDataOf({ ...VALID_FIELDS, returnTo: '/\\evil.com' }),
    );

    expect(result).toMatchObject({ ok: true, returnTo: '/' });
  });
});

describe('loginAction — pre-validation', () => {
  it('empty password → per-field error, no network call', async () => {
    const result = await loginAction(
      null,
      formDataOf({ email: 'user@test.by', password: '', returnTo: '/' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(serverFetchMock).not.toHaveBeenCalled();
  });

  it('does NOT enforce password complexity on login (existing credentials may predate the policy)', async () => {
    serverFetchMock.mockResolvedValue(LOGIN_RESPONSE);

    const result = await loginAction(
      null,
      formDataOf({ email: 'user@test.by', password: 'legacy', returnTo: '/' }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(serverFetchMock).toHaveBeenCalled();
  });
});

describe('loginAction — backend error mapping', () => {
  it('maps 401 INVALID_CREDENTIALS to the generic Russian message (anti-enumeration)', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(401, 'Invalid email/phone or password', 'INVALID_CREDENTIALS'),
    );

    const result = await loginAction(null, formDataOf(VALID_FIELDS));

    expect(result).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' });
    const message = (result as { message: string }).message;
    expect(message).toMatch(/Неверный email или пароль/);
    // Generic on purpose: must not hint whether the account exists.
    expect(message).not.toMatch(/не найден|существует/i);
    expect(mockStore.set).not.toHaveBeenCalled();
    // Email echoed for the post-reset repopulation; password never echoed.
    expect(result).toMatchObject({ values: { email: VALID_FIELDS.email } });
    expect(JSON.stringify(result)).not.toContain(VALID_FIELDS.password);
  });

  it('maps 429 RATE_LIMIT_EXCEEDED to the Russian try-later message', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(429, 'Rate limit exceeded for this endpoint.', 'RATE_LIMIT_EXCEEDED'),
    );

    const result = await loginAction(null, formDataOf(VALID_FIELDS));

    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMIT_EXCEEDED' });
    expect((result as { message: string }).message).toMatch(/Слишком много попыток/);
  });
});
