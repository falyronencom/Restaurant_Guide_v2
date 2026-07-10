/**
 * Auth error-code russification guard (email-channel Slice 2 — B1 anti-drift
 * pattern, mirrors partner-errors.test.ts). messageForCode maps backend auth
 * codes → Russian; a code the backend actually throws but the map omits
 * degrades SILENTLY to the neutral fallback. This pins the verify-email
 * contract set (DISCOVERY_slice2 §2: both endpoints' service codes + the
 * middleware limiter code + authedFetch's NO_SESSION) so a future backend
 * addition can't regress unnoticed.
 *
 * Source of truth: backend authController/authService verify-email paths +
 * rateLimiter middleware (manual cross-target sync — no shared package).
 */
import { messageForCode } from '@/lib/auth/errors';

// [code, HTTP status the backend pairs it with]
const VERIFY_CODES: Array<[string, number]> = [
  ['INVALID_CODE', 401],
  ['INVALID_OR_EXPIRED_CODE', 410],
  ['TOO_MANY_ATTEMPTS', 429],
  ['RATE_LIMITED', 429],
  ['RATE_LIMIT_EXCEEDED', 429],
  ['NO_EMAIL', 400],
  ['EMAIL_ALREADY_VERIFIED', 409],
  ['INVALID_REQUEST', 400],
  ['NO_SESSION', 401],
];

// Slice-1 codes that moved here out of actions.ts — pinned so the extraction
// (or a later edit) can't silently drop them.
const MOVED_SLICE1_CODES: Array<[string, number]> = [
  ['INVALID_CREDENTIALS', 401],
  ['EMAIL_EXISTS', 409],
  ['INVALID_OR_EXPIRED_TOKEN', 410],
];

const FALLBACK = 'Не удалось выполнить запрос. Попробуйте позже.';

describe('messageForCode — verify-email code coverage (anti-drift)', () => {
  it.each(VERIFY_CODES)('maps %s to a specific message', (code, status) => {
    const msg = messageForCode(code, status);
    expect(msg).not.toBe(FALLBACK);
    expect(msg.length).toBeGreaterThan(0);
  });

  it('410 exhaustion copy says «запросите новый», not «слишком много попыток»', () => {
    // After 5 wrong tries the 6th call is 410 (the 5th increment marks the
    // code used) — the user must be told to request a NEW code.
    const msg = messageForCode('INVALID_OR_EXPIRED_CODE', 410);
    expect(msg).toMatch(/запросите новый/i);
    expect(msg).not.toMatch(/слишком много/i);
  });
});

describe('messageForCode — extraction safety + fallback behaviour', () => {
  it.each(MOVED_SLICE1_CODES)('still maps %s specifically', (code, status) => {
    expect(messageForCode(code, status)).not.toBe(FALLBACK);
  });

  it('falls back to the neutral message for an unknown code', () => {
    expect(messageForCode('SOME_FUTURE_CODE', 500)).toBe(FALLBACK);
    expect(messageForCode(undefined, 500)).toBe(FALLBACK);
  });

  it('keeps the 429 status default for an unknown/absent code', () => {
    expect(messageForCode(undefined, 429)).toBe(
      'Слишком много попыток входа. Попробуйте позже.',
    );
  });
});
