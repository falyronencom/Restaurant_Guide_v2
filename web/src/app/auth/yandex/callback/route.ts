import { redirect } from 'next/navigation';

import { serverFetch } from '@/lib/api/client';
import { visitorAddressFrom } from '@/lib/api/visitor';
import { type OAuthLoginData } from '@/lib/api/types';
import { loginWithAuthError, yandexErrorCode } from '@/lib/auth/oauth-error';
import { consumeYState, persistOAuthSession } from '@/lib/auth/session';
import { exchangeCodeForToken, guardReturnTo } from '@/lib/auth/yandex';

/*
 * Yandex OAuth callback (DECISION #6) — the ONE web surface OUTSIDE the
 * Server-Action CSRF model (Next's POST-only + Origin/Host check applies to
 * Server Actions, not Route Handlers). Its CSRF defense is the `state`
 * round-trip via the single-use y_state cookie: a request whose ?state= does
 * not equal the nonce stored at initiation is rejected.
 *
 * Strict R2 ladder, in order:
 *   (1) Yandex-side error param (e.g. access_denied) → reject, NO outbound
 *   (2) state missing / mismatch                     → reject, NO outbound
 *       (anti-abuse: an invalid hit triggers zero external calls)
 *   (3) exchange code → Yandex access_token          (web-tier outbound)
 *   (4) POST the access_token to the FROZEN backend /auth/oauth (mobile's
 *       exact contract — {provider:'yandex', token})
 *   (5) persist the backend session (web is the cookie issuer)
 *   (6) success → redirect to returnTo
 * Every failure lands on /login?auth_error=<code>&returnTo=… — /login shows
 * why in Russian (lib/auth/oauth-error.ts) and keeps the way back. Until
 * 18.10 it went to `${returnTo}?auth_error=1`, which no page read: a failed
 * Yandex sign-in was silent.
 *
 * Cookie + redirect = pattern P2 (D2): persistOAuthSession writes via
 * (await cookies()).set, then redirect() throws NEXT_REDIRECT and Next emits
 * those staged Set-Cookie headers ON the redirect response. redirect() MUST run
 * OUTSIDE try/catch, so the destination is computed into an outcome variable
 * and redirect() is called exactly once at the end.
 */

function authErrorUrl(returnTo: string, code = yandexErrorCode({ error: null })): string {
  return loginWithAuthError(returnTo, code);
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;

  // Consume the state cookie FIRST: its returnTo anchors every redirect below,
  // and the single-use cookie must be burned exactly once regardless of outcome.
  const yState = await consumeYState();
  const returnTo = guardReturnTo(yState?.r);

  // Outcome variable (safe default = failure). redirect() runs once, after the
  // try/catch — never inside it (NEXT_REDIRECT must not be swallowed).
  let destination = authErrorUrl(returnTo);

  try {
    const error = sp.get('error');
    const state = sp.get('state');
    const code = sp.get('code');

    if (error) {
      // (1) Yandex denied / errored — no outbound. access_denied is the
      //     visitor pressing «Отмена» on Yandex's own page.
      destination = authErrorUrl(
        returnTo,
        error === 'access_denied'
          ? yandexErrorCode({ cancelled: true })
          : yandexErrorCode({ error }),
      );
    } else if (!yState || !state || state !== yState.n) {
      // (2) State absent or mismatched — reject without any outbound call.
      destination = authErrorUrl(returnTo);
    } else if (!code) {
      // Valid state but no code (malformed callback) — reject, no outbound.
      destination = authErrorUrl(returnTo);
    } else {
      // (3) Exchange the authorization code for a Yandex access_token.
      const accessToken = await exchangeCodeForToken(code);
      // (4) Hand the token to the frozen backend — identical to mobile.
      const data = await serverFetch<OAuthLoginData>('/api/v1/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'yandex', token: accessToken }),
      }, { visitor: visitorAddressFrom(request.headers) });
      // (5) Persist the backend-issued session (shared with Google flow).
      await persistOAuthSession(data);
      // (6) Success.
      destination = returnTo;
    }
  } catch (err) {
    // Any failure in (3)–(5): transport, timeout, backend 4xx, etc. The
    // access_token is never logged or persisted (R3). A known backend refusal
    // (closed account, rate limit) keeps its own Russian text on /login.
    destination = authErrorUrl(returnTo, yandexErrorCode({ error: err }));
  }

  redirect(destination);
}
