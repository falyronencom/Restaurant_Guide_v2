import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Client-error beacon (OSB-P6, вариант B — минимальный собственный сток).
 *
 * The (public) error boundary used to log render errors only to the
 * VISITOR's browser console — the operator never saw them. This handler
 * receives a fire-and-forget report from the error boundary and re-logs it
 * server-side, where Railway's log stream makes it operator-visible.
 *
 * Deliberately NOT a Sentry integration: no third party receives visitor
 * data (99-З surface stays ours), no SDK weight. Full Sentry remains a
 * post-launch option on signal.
 *
 * PII discipline: we log ONLY what the client sends after field-capping
 * (message/stack/digest/path) + the user agent for browser triage. No IP,
 * no cookies, no query strings (client sends location.pathname only).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELD_CAPS = {
  message: 500,
  stack: 4000,
  digest: 100,
  path: 200,
} as const;

/*
 * Instance-wide fixed-window throttle: an error loop on a single client (or
 * a log-spam attempt — the endpoint is unauthenticated) must not flood the
 * Railway log stream. Deliberately not per-IP: reading client IPs is exactly
 * the PII this sink avoids, and the operator only needs a sample of a storm,
 * not every occurrence.
 */
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 30;
let windowStart = 0;
let windowCount = 0;

function takeSlot(): boolean {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= WINDOW_LIMIT;
}

function cappedString(value: unknown, cap: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.slice(0, cap);
}

/*
 * request.json() buffers the whole body BEFORE the field caps run, and this
 * is the one zero-cookie endpoint — so cap via Content-Length first. A
 * browser fetch with a string body always sends Content-Length (keepalive
 * even requires a known length); absent/non-numeric means a hand-rolled
 * chunked request — reject rather than buffer it. NB: Number(null) is 0,
 * hence the explicit null/format check, not a bare Number() coercion.
 */
const MAX_BODY_BYTES = 32_768;

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  if (!takeSlot()) return new Response(null, { status: 429 });

  const contentLength = request.headers.get('content-length');
  if (
    contentLength === null ||
    !/^\d+$/.test(contentLength) ||
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    return new Response(null, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return new Response(null, { status: 400 });
  }

  const report = body as Record<string, unknown>;
  const message = cappedString(report.message, FIELD_CAPS.message);
  if (!message) return new Response(null, { status: 400 });

  // Single-line JSON with a greppable prefix — lands in the web service's
  // Railway log stream via stderr.
  console.error(
    '[client-error]',
    JSON.stringify({
      message,
      digest: cappedString(report.digest, FIELD_CAPS.digest),
      path: cappedString(report.path, FIELD_CAPS.path),
      stack: cappedString(report.stack, FIELD_CAPS.stack),
      userAgent: cappedString(request.headers.get('user-agent'), 200),
    }),
  );

  return new Response(null, { status: 204 });
}
