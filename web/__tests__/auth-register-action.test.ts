/**
 * registerAction (Slice 2) — pre-validation, backend error mapping, session
 * persist, returnTo guard. Mock boundary per the established pattern: the API
 * client (serverFetch) + next/headers cookies(); the REAL actions.ts and
 * session.ts run, so the persist path (rg_at/rg_rt/rg_user writes) is pinned.
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
import { ApiError, type RegisterData } from '@/lib/api/types';
import { registerAction } from '@/lib/auth/actions';

const serverFetchMock = serverFetch as jest.Mock;

const REGISTER_RESPONSE: RegisterData = {
  user: {
    id: 'u-new',
    email: 'new@test.by',
    phone: null,
    name: 'Новый Пользователь',
    role: 'user',
    authMethod: 'email',
    createdAt: '2026-06-11T10:00:00.000Z',
  },
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'Bearer',
  expiresIn: 14400,
};

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID_FIELDS = {
  name: 'Новый Пользователь',
  email: 'new@test.by',
  password: 'Passw0rd',
  returnTo: '/minsk/restorany',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockReturnValue(undefined);
});

describe('registerAction — success', () => {
  it('POSTs email-only payload, persists the session, returns the guarded returnTo', async () => {
    serverFetchMock.mockResolvedValue(REGISTER_RESPONSE);

    const result = await registerAction(null, formDataOf(VALID_FIELDS));

    // The backend parses a JSON body only under application/json
    // (server.js, express.json): without the header the body arrives
    // empty and the request is refused.
    expect(serverFetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/register',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
      { visitor: null },
    );
    const body = JSON.parse(
      (serverFetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    // Email-only registration: authMethod pinned, phone never sent.
    expect(body).toEqual({
      email: 'new@test.by',
      password: 'Passw0rd',
      name: 'Новый Пользователь',
      authMethod: 'email',
    });
    expect('phone' in body).toBe(false);

    expect(result).toEqual({
      ok: true,
      returnTo: '/minsk/restorany',
      user: {
        id: 'u-new',
        email: 'new@test.by',
        name: 'Новый Пользователь',
        role: 'user',
        avatarUrl: null, // widened from the register response (field absent)
      },
    });

    // Session persist went through the shared writer: tokens + display user.
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_at',
      'access-1',
      expect.objectContaining({ httpOnly: true, maxAge: 14400 }),
    );
    expect(mockStore.set).toHaveBeenCalledWith(
      'rg_rt',
      'refresh-1',
      expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 30 }),
    );
    const userCall = mockStore.set.mock.calls.find((c) => c[0] === 'rg_user');
    expect(userCall).toBeDefined();
    expect(JSON.parse(userCall![1] as string)).toMatchObject({
      id: 'u-new',
      avatarUrl: null,
    });
  });

  it('collapses an unsafe returnTo to / (guard inside the action, not only the page)', async () => {
    serverFetchMock.mockResolvedValue(REGISTER_RESPONSE);

    const result = await registerAction(
      null,
      formDataOf({ ...VALID_FIELDS, returnTo: '//evil.com' }),
    );

    expect(result).toMatchObject({ ok: true, returnTo: '/' });
  });
});

describe('registerAction — pre-validation (no network call)', () => {
  it.each([
    ['weak password', { ...VALID_FIELDS, password: 'short' }, 'password'],
    // One rule at a time — 'short' breaks three at once and proves none alone.
    ['password of 7 characters', { ...VALID_FIELDS, password: 'Abcdef1' }, 'password'],
    ['password without an uppercase letter', { ...VALID_FIELDS, password: 'abcdefg1' }, 'password'],
    ['password without a lowercase letter', { ...VALID_FIELDS, password: 'ABCDEFG1' }, 'password'],
    ['password without digits', { ...VALID_FIELDS, password: 'NoDigitsHere' }, 'password'],
    ['malformed email', { ...VALID_FIELDS, email: 'not-an-email' }, 'email'],
    ['email without a dot in the domain', { ...VALID_FIELDS, email: 'anna@mail' }, 'email'],
    ['too-short name', { ...VALID_FIELDS, name: 'Я' }, 'name'],
    ['name with a comma and a dot', { ...VALID_FIELDS, name: 'Анна, К.' }, 'name'],
    ['name with digits', { ...VALID_FIELDS, name: 'Иван2000' }, 'name'],
    ['51-letter name', { ...VALID_FIELDS, name: 'А'.repeat(51) }, 'name'],
  ])('%s → per-field Russian error, serverFetch untouched', async (_label, fields, field) => {
    const result = await registerAction(null, formDataOf(fields));

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(
      (result as { fieldErrors?: Record<string, string> }).fieldErrors?.[field],
    ).toMatch(/[А-Яа-яЁё]/);
    expect(serverFetchMock).not.toHaveBeenCalled();
    expect(mockStore.set).not.toHaveBeenCalled();
    // Echo for the React-19 post-action form reset: name+email, NEVER password.
    const values = (result as { values?: Record<string, string> }).values;
    expect(values).toEqual({
      name: (fields as Record<string, string>).name.trim(),
      email: (fields as Record<string, string>).email.trim(),
    });
    expect(JSON.stringify(result)).not.toContain(
      (fields as Record<string, string>).password,
    );
  });
});

describe('registerAction — backend error mapping', () => {
  it('maps 409 EMAIL_EXISTS to the Russian duplicate-account message', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(409, 'An account with this email already exists', 'EMAIL_EXISTS'),
    );

    const result = await registerAction(null, formDataOf(VALID_FIELDS));

    expect(result).toMatchObject({ ok: false, code: 'EMAIL_EXISTS' });
    expect((result as { message: string }).message).toMatch(/уже зарегистрирован/);
    expect(mockStore.set).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      values: { name: VALID_FIELDS.name, email: VALID_FIELDS.email },
    });
  });

  it('maps 422 VALIDATION_ERROR details per-field to Russian texts (English never surfaces)', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(422, 'Invalid input data', 'VALIDATION_ERROR', {
        password: ['Password must contain at least one uppercase letter'],
        name: ['Name can only contain letters, spaces, hyphens and apostrophes'],
      }),
    );

    const result = await registerAction(null, formDataOf(VALID_FIELDS));

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    const { fieldErrors, message } = result as {
      fieldErrors?: Record<string, string>;
      message: string;
    };
    expect(fieldErrors?.password).toMatch(/[А-Яа-яЁё]/);
    expect(fieldErrors?.name).toMatch(/[А-Яа-яЁё]/);
    expect(fieldErrors?.email).toBeUndefined();
    expect(message).not.toMatch(/[A-Za-z]/); // no English leaks into the summary
  });

  it("shows the server's Russian refusal of the name as is (мат)", async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(422, 'Имя содержит недопустимые слова', 'VALIDATION_ERROR', {
        name: ['Имя содержит недопустимые слова'],
      }),
    );

    const result = await registerAction(null, formDataOf(VALID_FIELDS));

    expect(
      (result as { fieldErrors?: Record<string, string> }).fieldErrors?.name,
    ).toBe('Имя содержит недопустимые слова');
  });

  it('takes a Belarusian name with і and ў in the pre-check', async () => {
    serverFetchMock.mockRejectedValue(new Error('fetch failed'));
    const result = await registerAction(
      null,
      formDataOf({ ...VALID_FIELDS, name: 'Алеся Ўладзіслаўна' }),
    );
    // reached the network: the pre-check let the name through
    expect(serverFetchMock).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
  });

  // The real transport never throws a plain Error: serverFetch turns every
  // fetch or abort failure into ApiError(0, 'Fetch failed for …')
  // (lib/api/client.ts). So the transport case is the ApiError branch — a
  // code-less HTTP_0 and the neutral text; the NETWORK branch is only for a
  // throwable that is not an ApiError at all.
  it('maps the transport failure (ApiError 0 from serverFetch) to HTTP_0 and the neutral message', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(0, 'Fetch failed for /api/v1/auth/register: fetch failed'),
    );

    const result = await registerAction(null, formDataOf(VALID_FIELDS));

    expect(result).toMatchObject({
      ok: false,
      code: 'HTTP_0',
      message: 'Не удалось выполнить запрос. Попробуйте позже.',
    });
  });

  it('maps a failure that is not an ApiError to the network message', async () => {
    serverFetchMock.mockRejectedValue(new Error('fetch failed'));

    const result = await registerAction(null, formDataOf(VALID_FIELDS));

    // The message, not only the code: the form shows the message.
    expect(result).toMatchObject({
      ok: false,
      code: 'NETWORK',
      message: 'Сеть недоступна. Попробуйте позже.',
    });
  });
});
