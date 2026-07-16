/*
 * Fire-and-forget client-error beacon (OSB-P6, вариант B).
 *
 * Called from error boundaries (Client Components) to make visitor-side
 * render errors operator-visible: POSTs to our own /api/client-error, which
 * re-logs into the Railway log stream. No third party involved.
 *
 * MUST never throw and never affect the boundary's UI: every failure path
 * is swallowed. `keepalive` lets the report survive an imminent navigation.
 * Sends location.pathname only — never the query string (search params may
 * carry user free-text).
 */

import 'client-only';

/*
 * Field caps mirror the server's — pre-slicing keeps the keepalive body
 * under Chromium's ~64KB in-flight quota (an oversized keepalive fetch is
 * rejected, and the rejection would be silently swallowed below).
 */
export function reportClientError(error: Error & { digest?: string }): void {
  try {
    const payload = JSON.stringify({
      message: (error.message || 'Unknown client error').slice(0, 500),
      digest: error.digest?.slice(0, 100),
      stack: error.stack?.slice(0, 4000),
      path: window.location.pathname.slice(0, 200),
    });

    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting is best-effort by design — never break the error UI itself.
  }
}
