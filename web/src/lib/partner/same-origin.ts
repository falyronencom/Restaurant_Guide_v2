import 'server-only';

/*
 * Same-origin (CSRF) guard for the partner cabinet Route Handlers (CAT-C-3.14).
 *
 * Moving the cabinet's six operations off Server Actions onto POST Route
 * Handlers forfeits Next's built-in Server-Action CSRF defense (POST-only +
 * Origin/Host check — see lib/auth DECISION #5). This restores EXACT parity: a
 * cross-site POST cannot satisfy the same-origin check below, so it cannot ride
 * the user's httpOnly SameSite=Lax session cookies to drive a cabinet write.
 *
 * Host resolution mirrors Next internally: prefer X-Forwarded-Host (set by the
 * Railway edge to the public host) over Host (the internal origin behind the
 * proxy). The edge overwrites a client-supplied X-Forwarded-Host, so trusting it
 * behind Railway is safe — identical to how the Server-Action defense behaves.
 *
 * Failure returns a {ok:false,code:'CSRF'} envelope so the client fetch layer
 * reads it like any other result (callers branch on `r.ok`).
 */

function forbidden(): Response {
  return new Response(JSON.stringify({ ok: false, code: 'CSRF' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Returns a 403 Response when the request is not same-origin, else null (pass).
 * Apply at the top of every partner Route Handler, before reading the body.
 */
export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  // Browsers always send Origin on a POST (even same-origin). A missing Origin
  // on a state-changing request is not a legitimate browser call → reject.
  if (!origin) return forbidden();

  const expectedHost =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!expectedHost) return forbidden();

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return forbidden();
  }

  return originHost === expectedHost ? null : forbidden();
}
