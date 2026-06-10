import 'server-only';

import { getSiteUrl } from '@/lib/seo-gate';

/*
 * Server-only Yandex OAuth helpers (Phase B — Yandex web flow).
 *
 * Why authorization-code (not mobile's implicit flow): mobile reads the
 * implicit access_token from the redirect URL *fragment* client-side, but a
 * server-side callback only sees query params — so the web flow exchanges an
 * authorization `code` for the token here, which is why a client_secret is
 * required (mobile's implicit flow needs none).
 *
 * The resulting access_token is handed to the FROZEN backend
 * POST /auth/oauth {provider:'yandex', token} — identical to mobile's contract —
 * then discarded (never persisted): the session is the backend-issued JWT pair.
 *
 * Secrets (YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET) are read ONLY in this
 * module; `import 'server-only'` fails the build if a Client Component imports
 * it. R3: never log code / token / secret.
 */

const AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
const TOKEN_URL = 'https://oauth.yandex.ru/token';
const CALLBACK_PATH = '/auth/yandex/callback';
const EXCHANGE_TIMEOUT_MS = 10_000;

/**
 * The https redirect_uri registered in the Yandex OAuth console. Built from
 * SITE_URL (via the shared getSiteUrl) so dev (localhost) and prod (nirivio.by)
 * both resolve correctly; the SAME value must be sent to /authorize AND /token
 * — Yandex matches them (D5).
 */
function redirectUri(): string {
  return `${getSiteUrl()}${CALLBACK_PATH}`;
}

function clientId(): string {
  const id = process.env.YANDEX_CLIENT_ID;
  if (!id) {
    throw new Error(
      'YANDEX_CLIENT_ID is not set. Add it to web/.env.local (dev) or the deploy platform (prod).',
    );
  }
  return id;
}

function clientSecret(): string {
  const secret = process.env.YANDEX_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      'YANDEX_CLIENT_SECRET is not set. Add it to web/.env.local (dev) or the deploy platform (prod).',
    );
  }
  return secret;
}

/**
 * Build the Yandex authorization-code URL. `state` is the single-use nonce that
 * round-trips via the y_state cookie — login-CSRF defense, since the callback
 * Route Handler sits outside Next's Server-Action CSRF model (DECISION #6).
 * `force_confirm` is intentionally NOT set (R1).
 */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for a Yandex OAuth access_token. POSTs
 * x-www-form-urlencoded to oauth.yandex.ru/token with a 10s timeout (mirrors
 * serverFetch's transport budget). Throws on transport failure, timeout,
 * non-2xx, non-JSON, or a response without an access_token. The thrown
 * messages carry neither the code nor the secret (R3).
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Yandex token exchange transport failure: ${message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Yandex token exchange failed (HTTP ${response.status})`);
  }

  let payload: { access_token?: unknown };
  try {
    payload = (await response.json()) as { access_token?: unknown };
  } catch {
    throw new Error('Yandex token exchange returned a non-JSON response');
  }

  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new Error('Yandex token exchange returned no access_token');
  }
  return payload.access_token;
}

/**
 * Open-redirect guard (D4). Accept only a same-origin RELATIVE path beginning
 * with a single slash — rejects protocol-relative `//evil.com` and absolute
 * URLs. Anything else collapses to '/'.
 */
export function guardReturnTo(returnTo: string | null | undefined): string {
  if (typeof returnTo === 'string' && /^\/(?!\/)/.test(returnTo)) {
    return returnTo;
  }
  return '/';
}
