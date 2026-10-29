/**
 * The site's sign-in refusals say the backend's words (Coordinator 25.10 and
 * 29.10.2026: one dictionary of sign-in refusals for the server, the app and
 * the site). The site prints its own text by code — messageForCode — so a
 * backend rewording would leave the two apart silently; this guard reads the
 * backend dictionary (backend/src/constants/authRefusals.js) as text, the way
 * the backend writes it — `key: '…'` or `` key: `…${SUPPORT_EMAIL}…` `` on one
 * line — and holds every shared case equal.
 *
 * Mirror of the app's guard (mobile/test/providers/auth_refusals_guard_test.dart).
 * CI checks the whole repository out, so ../backend is always there (as for
 * session-refusal-codes-guard.test.ts).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { messageForCode } from '@/lib/auth/errors';
import { YANDEX_FAILED_TEXT } from '@/lib/auth/oauth-error';

const DICTIONARY = join(__dirname, '..', '..', 'backend', 'src', 'constants', 'authRefusals.js');

function backendDictionary(): Record<string, string> {
  const source = readFileSync(DICTIONARY, 'utf8');
  const support = /export const SUPPORT_EMAIL = '([^']+)'/.exec(source)?.[1];
  if (!support) throw new Error('authRefusals.js: no SUPPORT_EMAIL');
  const entries: Record<string, string> = {};
  for (const m of source.matchAll(/^\s*(\w+):\s*(['`])(.*)\2,\s*$/gm)) {
    entries[m[1]] = m[3].replaceAll('${SUPPORT_EMAIL}', support);
  }
  return entries;
}

const server = backendDictionary();

// [backend code, its HTTP status, the backend dictionary key]
const SHARED: Array<[string, number, string]> = [
  ['INVALID_TOKEN', 401, 'oauthGoogleFailed'],
  ['OAUTH_NO_EMAIL', 400, 'oauthNoEmail'],
  ['OAUTH_EMAIL_NOT_VERIFIED', 403, 'oauthEmailNotVerified'],
  ['ACCOUNT_DEACTIVATED', 403, 'accountDeactivated'],
  ['ACCOUNT_CONFLICT', 409, 'oauthConflict'],
  ['EMAIL_EXISTS', 409, 'emailExists'],
  ['INVALID_OR_EXPIRED_TOKEN', 410, 'resetLinkInvalid'],
  ['INVALID_CODE', 401, 'codeInvalid'],
  ['INVALID_OR_EXPIRED_CODE', 410, 'codeExpired'],
  ['TOO_MANY_ATTEMPTS', 429, 'codeTooManyAttempts'],
  ['RATE_LIMITED', 429, 'codeSendLimited'],
  ['NO_EMAIL', 400, 'noEmail'],
  ['EMAIL_ALREADY_VERIFIED', 409, 'emailAlreadyVerified'],
  ['INVALID_REQUEST', 400, 'codeFormat'],
];

describe('sign-in refusals — the backend dictionary words', () => {
  it('the dictionary parses (a blind parse would make every check vacuous)', () => {
    expect(Object.keys(server).length).toBeGreaterThanOrEqual(35);
  });

  it.each(SHARED)('%s says the backend words (%s, %s)', (code, status, key) => {
    expect(server[key]).toBeDefined();
    expect(messageForCode(code, status)).toBe(server[key]);
  });

  it('a failed Yandex sign-in says the backend words', () => {
    expect(YANDEX_FAILED_TEXT).toBe(server.oauthYandexFailed);
  });

  it('a closed account names the support address', () => {
    expect(messageForCode('ACCOUNT_DEACTIVATED', 403)).toContain('support@nirivio.by');
  });

  it('wrong credentials: the backend sentence narrowed to email — the site signs in by email only', () => {
    expect(server.invalidCredentials).toBe('Неверный email/телефон или пароль.');
    expect(messageForCode('INVALID_CREDENTIALS', 401)).toBe('Неверный email или пароль.');
  });
});
