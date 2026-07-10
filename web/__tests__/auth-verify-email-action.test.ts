/**
 * verifyEmailCodeAction / resendVerificationCodeAction — the authed verify
 * contract: 6-digit pre-check (mirrors the backend's inline 400, no network
 * call), exact request shapes, and the Russian mapping for every code the
 * contract produces — incl. the 410-after-exhaustion footgun and the graceful
 * 409 EMAIL_ALREADY_VERIFIED. Mock boundary is authedFetch (the authed-action
 * boundary — favorites pattern), NOT serverFetch: these actions must never
 * touch the unauthenticated client path.
 */
const mockAuthedFetch = jest.fn();

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve({ get: jest.fn(), set: jest.fn(), delete: jest.fn() })),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));
// actions.ts imports many session helpers at module top; only authedFetch is
// on the verify path — the rest are inert stubs so the module loads.
jest.mock('@/lib/auth/session', () => ({
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
  clearSession: jest.fn(),
  consumeNonce: jest.fn(),
  getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
  getSessionUser: jest.fn(),
  persistOAuthSession: jest.fn(),
  refreshSession: jest.fn(),
  setNonce: jest.fn(),
  setYState: jest.fn(),
}));

import { serverFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';
import {
  resendVerificationCodeAction,
  verifyEmailCodeAction,
} from '@/lib/auth/actions';

const serverFetchMock = serverFetch as jest.Mock;

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('verifyEmailCodeAction — success', () => {
  it('POSTs the code to verify-email-code via authedFetch and returns ok', async () => {
    mockAuthedFetch.mockResolvedValue({ user: { emailVerified: true } });

    const result = await verifyEmailCodeAction(null, formDataOf({ code: '123456' }));

    expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/auth/verify-email-code',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (mockAuthedFetch.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toEqual({ code: '123456' });

    expect(result).toEqual({ ok: true });
    expect(serverFetchMock).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace before validating', async () => {
    mockAuthedFetch.mockResolvedValue({});

    const result = await verifyEmailCodeAction(null, formDataOf({ code: ' 123456 ' }));

    expect(result).toEqual({ ok: true });
    const body = JSON.parse(
      (mockAuthedFetch.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toEqual({ code: '123456' });
  });
});

describe('verifyEmailCodeAction — pre-check (mirrors backend inline 400)', () => {
  it.each(['12345', '1234567', 'abcdef', '12 456', ''])(
    'rejects %j without a network call and echoes the entered code',
    async (bad) => {
      const result = await verifyEmailCodeAction(null, formDataOf({ code: bad }));

      expect(result).toMatchObject({
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Введите 6-значный код из письма.',
        values: { code: bad.trim() },
      });
      expect(mockAuthedFetch).not.toHaveBeenCalled();
    },
  );
});

describe('verifyEmailCodeAction — backend error mapping', () => {
  it('maps 401 INVALID_CODE and echoes the code for correction', async () => {
    mockAuthedFetch.mockRejectedValue(
      new ApiError(401, 'Invalid verification code', 'INVALID_CODE'),
    );

    const result = await verifyEmailCodeAction(null, formDataOf({ code: '111111' }));

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_CODE',
      values: { code: '111111' },
    });
    expect((result as { message: string }).message).toMatch(/Неверный код/);
  });

  it('maps the 410 exhaustion/expiry to the request-a-new-code copy', async () => {
    // The 6th call after 5 wrong tries returns 410, NOT 429 — the copy must
    // say "request a new code", never "too many attempts".
    mockAuthedFetch.mockRejectedValue(
      new ApiError(410, 'Verification code is invalid or expired', 'INVALID_OR_EXPIRED_CODE'),
    );

    const result = await verifyEmailCodeAction(null, formDataOf({ code: '222222' }));

    expect(result).toMatchObject({ ok: false, code: 'INVALID_OR_EXPIRED_CODE' });
    expect((result as { message: string }).message).toBe(
      'Код неверный или истёк — запросите новый.',
    );
  });

  it('passes through 409 EMAIL_ALREADY_VERIFIED (the island renders it as a terminal state)', async () => {
    mockAuthedFetch.mockRejectedValue(
      new ApiError(409, 'Email is already verified', 'EMAIL_ALREADY_VERIFIED'),
    );

    const result = await verifyEmailCodeAction(null, formDataOf({ code: '333333' }));

    expect(result).toMatchObject({ ok: false, code: 'EMAIL_ALREADY_VERIFIED' });
  });

  it('maps NO_SESSION (logged-out direct visitor) to the login invite', async () => {
    mockAuthedFetch.mockRejectedValue(new ApiError(401, 'Not authenticated', 'NO_SESSION'));

    const result = await verifyEmailCodeAction(null, formDataOf({ code: '444444' }));

    expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' });
    expect((result as { message: string }).message).toMatch(/Войдите/);
  });

  it('maps a non-ApiError failure to NETWORK', async () => {
    mockAuthedFetch.mockRejectedValue(new Error('socket hang up'));

    const result = await verifyEmailCodeAction(null, formDataOf({ code: '555555' }));

    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
  });
});

describe('resendVerificationCodeAction', () => {
  it('POSTs to send-verification-code and returns the sent confirmation', async () => {
    mockAuthedFetch.mockResolvedValue({ sent: true, expiresAt: '2026-07-10T12:00:00Z' });

    const result = await resendVerificationCodeAction(null, new FormData());

    expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/auth/send-verification-code',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({
      ok: true,
      message: 'Мы отправили новый код на вашу почту.',
    });
  });

  it('returns the SAME confirmation when the email transport is unconfigured (sent:false)', async () => {
    mockAuthedFetch.mockResolvedValue({ sent: false, expiresAt: '2026-07-10T12:00:00Z' });

    const result = await resendVerificationCodeAction(null, new FormData());

    expect(result).toEqual({
      ok: true,
      message: 'Мы отправили новый код на вашу почту.',
    });
  });

  it('maps the service throttle 429 RATE_LIMITED', async () => {
    mockAuthedFetch.mockRejectedValue(
      new ApiError(429, 'Too many verification emails requested', 'RATE_LIMITED'),
    );

    const result = await resendVerificationCodeAction(null, new FormData());

    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect((result as { message: string }).message).toMatch(/Попробуйте позже/);
  });

  it('passes through 409 EMAIL_ALREADY_VERIFIED for the terminal rendering', async () => {
    mockAuthedFetch.mockRejectedValue(
      new ApiError(409, 'Email is already verified', 'EMAIL_ALREADY_VERIFIED'),
    );

    const result = await resendVerificationCodeAction(null, new FormData());

    expect(result).toMatchObject({ ok: false, code: 'EMAIL_ALREADY_VERIFIED' });
  });
});
