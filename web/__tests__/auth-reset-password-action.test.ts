/**
 * resetPasswordAction — token consumption flow: hidden-input token + new
 * password POSTed to the backend, register-grade complexity pre-check,
 * 410 INVALID_OR_EXPIRED_TOKEN mapping, backend-422 per-field mapping.
 * The new password must never be echoed back through the action state.
 * Same mock boundary as auth-login-action.test.ts.
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
import { ApiError } from '@/lib/api/types';
import { resetPasswordAction } from '@/lib/auth/actions';

const serverFetchMock = serverFetch as jest.Mock;

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockReturnValue(undefined);
});

describe('resetPasswordAction — success', () => {
  it('POSTs token+password and returns the done message with a login hint', async () => {
    serverFetchMock.mockResolvedValue({ message: 'Password has been reset successfully' });

    const result = await resetPasswordAction(
      null,
      formDataOf({ token: TOKEN, password: 'NewPass456' }),
    );

    expect(serverFetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/reset-password',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (serverFetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toEqual({ token: TOKEN, password: 'NewPass456' });

    expect(result).toEqual({
      ok: true,
      message: 'Пароль изменён. Войдите с новым паролем.',
    });
  });
});

describe('resetPasswordAction — pre-validation', () => {
  it('weak password → per-field error, no network call, password NOT echoed', async () => {
    const result = await resetPasswordAction(
      null,
      formDataOf({ token: TOKEN, password: 'weak' }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
      fieldErrors: { password: expect.stringMatching(/8 символов/) },
    });
    expect(serverFetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('weak');
  });

  it('missing token → INVALID_OR_EXPIRED_TOKEN without a network call', async () => {
    const result = await resetPasswordAction(
      null,
      formDataOf({ password: 'NewPass456' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_OR_EXPIRED_TOKEN' });
    expect(serverFetchMock).not.toHaveBeenCalled();
  });
});

describe('resetPasswordAction — backend error mapping', () => {
  it('maps 410 INVALID_OR_EXPIRED_TOKEN to the Russian request-new-link message', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(410, 'Reset link is invalid or has expired', 'INVALID_OR_EXPIRED_TOKEN'),
    );

    const result = await resetPasswordAction(
      null,
      formDataOf({ token: TOKEN, password: 'NewPass456' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_OR_EXPIRED_TOKEN' });
    expect((result as { message: string }).message).toMatch(/недействительна или устарела/);
  });

  it('maps a backend 422 to the per-field password text', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(422, 'Invalid input data', 'VALIDATION_ERROR', {
        password: ['Password must contain at least one digit'],
      }),
    );

    const result = await resetPasswordAction(
      null,
      formDataOf({ token: TOKEN, password: 'NoDigitsPass' }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
      fieldErrors: { password: expect.stringMatching(/8 символов/) },
    });
    expect(JSON.stringify(result)).not.toContain('NoDigitsPass');
  });

  it('maps 429 RATE_LIMIT_EXCEEDED to the Russian try-later message', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(429, 'Rate limit exceeded for this endpoint.', 'RATE_LIMIT_EXCEEDED'),
    );

    const result = await resetPasswordAction(
      null,
      formDataOf({ token: TOKEN, password: 'NewPass456' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMIT_EXCEEDED' });
    expect((result as { message: string }).message).toMatch(/Слишком много попыток/);
  });
});
