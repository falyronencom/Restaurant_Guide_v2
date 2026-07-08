/**
 * forgotPasswordAction — enumeration-safe request flow: one fixed Russian
 * confirmation for every backend 200 (the backend already answers identically
 * for existing and unknown emails), per-field pre-validation, 429/network
 * mapping. Same mock boundary as auth-login-action.test.ts.
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
import { forgotPasswordAction } from '@/lib/auth/actions';

const serverFetchMock = serverFetch as jest.Mock;

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.get.mockReturnValue(undefined);
});

describe('forgotPasswordAction — success', () => {
  it('POSTs the email and returns the fixed generic confirmation', async () => {
    serverFetchMock.mockResolvedValue({ message: 'backend english text' });

    const result = await forgotPasswordAction(
      null,
      formDataOf({ email: 'user@test.by' }),
    );

    expect(serverFetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/forgot-password',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (serverFetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toEqual({ email: 'user@test.by' });

    expect(result).toEqual({
      ok: true,
      message:
        'Если такой email зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля.',
    });
  });

  it('shows the SAME confirmation regardless of the backend message payload (enumeration safety)', async () => {
    serverFetchMock.mockResolvedValueOnce({ message: 'variant A' });
    const first = await forgotPasswordAction(
      null,
      formDataOf({ email: 'exists@test.by' }),
    );

    serverFetchMock.mockResolvedValueOnce({ message: 'variant B' });
    const second = await forgotPasswordAction(
      null,
      formDataOf({ email: 'ghost@test.by' }),
    );

    expect(first).toEqual(second);
  });
});

describe('forgotPasswordAction — pre-validation', () => {
  it('malformed email → per-field error, no network call, email echoed', async () => {
    const result = await forgotPasswordAction(
      null,
      formDataOf({ email: 'not-an-email' }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
      fieldErrors: { email: expect.stringMatching(/email/i) },
      values: { email: 'not-an-email' },
    });
    expect(serverFetchMock).not.toHaveBeenCalled();
  });
});

describe('forgotPasswordAction — backend error mapping', () => {
  it('maps 429 RATE_LIMIT_EXCEEDED to the Russian try-later message', async () => {
    serverFetchMock.mockRejectedValue(
      new ApiError(429, 'Rate limit exceeded for this endpoint.', 'RATE_LIMIT_EXCEEDED'),
    );

    const result = await forgotPasswordAction(
      null,
      formDataOf({ email: 'user@test.by' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMIT_EXCEEDED' });
    expect((result as { message: string }).message).toMatch(/Слишком много попыток/);
  });

  it('maps a network failure to the generic offline message', async () => {
    serverFetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await forgotPasswordAction(
      null,
      formDataOf({ email: 'user@test.by' }),
    );

    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
  });
});
