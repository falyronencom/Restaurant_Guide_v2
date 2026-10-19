import { messageForCode } from '@/lib/auth/errors';
import { ApiError } from '@/lib/api/types';

/*
 * A failed sign-in through Yandex, carried from the callback Route Handler to
 * /login as `?auth_error=<code>` (сверка находок тестировщика с сайтом, 18.10,
 * Х2 / п. 37). Before, the callback sent the visitor back to the page they
 * came from with `?auth_error=1`, which nothing read: the sign-in failed
 * silently. Now the visitor lands on /login (with the same way back), sees why
 * under the sign-in buttons and can try again or use another method.
 *
 * Only codes from this list travel in the URL — never a text, never a raw
 * backend code — so the page cannot be made to print arbitrary words.
 */

/** Backend codes of POST /auth/oauth whose own Russian text is worth showing. */
const BACKEND_CODES = [
  'ACCOUNT_DEACTIVATED',
  'ACCOUNT_CONFLICT',
  'RATE_LIMIT_EXCEEDED',
] as const;

const YANDEX_CANCELLED = 'yandex_cancelled';
const YANDEX_FAILED = 'yandex';

export const YANDEX_FAILED_TEXT =
  'Не удалось войти через Яндекс. Попробуйте ещё раз или войдите другим способом.';
export const YANDEX_CANCELLED_TEXT =
  'Вход через Яндекс отменён. Попробуйте ещё раз или войдите другим способом.';

/** The `auth_error` code for a failure in the callback. */
export function yandexErrorCode(
  failure: { cancelled: true } | { error: unknown },
): string {
  if ('cancelled' in failure) return YANDEX_CANCELLED;
  const err = failure.error;
  if (
    err instanceof ApiError &&
    err.errorCode &&
    (BACKEND_CODES as readonly string[]).includes(err.errorCode)
  ) {
    return err.errorCode;
  }
  return YANDEX_FAILED;
}

/** /login with the failure code and the guarded way back. */
export function loginWithAuthError(returnTo: string, code: string): string {
  const back =
    returnTo === '/' ? '' : `&returnTo=${encodeURIComponent(returnTo)}`;
  return `/login?auth_error=${encodeURIComponent(code)}${back}`;
}

/** The Russian text for an `auth_error` value; null when there is none. */
export function messageForAuthError(
  value: string | string[] | undefined,
): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (value === YANDEX_CANCELLED) return YANDEX_CANCELLED_TEXT;
  if ((BACKEND_CODES as readonly string[]).includes(value)) {
    return messageForCode(value, 0);
  }
  // `yandex`, the legacy `1`, anything else — the general text.
  return YANDEX_FAILED_TEXT;
}
