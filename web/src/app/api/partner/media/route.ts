import { NextResponse } from 'next/server';

import { getAccessToken, refreshSession } from '@/lib/auth/session';

/*
 * Partner media temp-upload proxy (Phase C Slice 1, Segment B — Decision 2).
 *
 * The ONE path for uploading establishment photos (≤10MB) and menu PDFs (≤60MB)
 * before the establishment exists. The browser cannot set the Bearer (web tokens
 * are httpOnly), so the upload must traverse the server tier — but a 60MB PDF
 * cannot go through a Server Action (1MB body cap) and must NOT be buffered.
 *
 * Mechanism: stream the raw multipart body straight to the backend
 *   POST /api/v1/partner/media/upload
 * with the original content-type (boundary preserved) and a server-injected
 * Bearer. We NEVER call request.formData()/clone() — either would buffer the
 * whole body in memory and re-encode it. duplex:'half' is required by undici for
 * a streamed request body.
 *
 * NAMED RISK (Decision 2): a reverse-proxy/edge body cap on Railway could reject
 * ~60MB before it reaches the backend. That is verified with a real 60MB file;
 * on failure the response surfaces the upstream status — the fix is escalation to
 * the Coordinator, never relaxing the httpOnly-token discipline.
 *
 * Auth: composed from session.ts public exports (the slice keeps session.ts to
 * the additive re-stamp only). Because a consumed stream cannot be retried, the
 * access token is refreshed PROACTIVELY when missing or near expiry (decoded
 * `exp`, same unverified base64url read used for the login nonce).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_UPLOAD_PATH = '/api/v1/partner/media/upload';
const EXP_SKEW_MS = 60_000; // refresh if the token expires within this window

function errorJson(message: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ success: false, error: { message, code } }, { status });
}

/** True when the access JWT is unreadable, expired, or within EXP_SKEW_MS of it. */
function accessTokenStale(token: string): boolean {
  const parts = token.split('.');
  if (parts.length < 2) return true;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return false; // unknown exp → let the backend 401 decide
    return payload.exp * 1000 <= Date.now() + EXP_SKEW_MS;
  } catch {
    return true;
  }
}

/** A usable access token, proactively refreshed before streaming. Null = no session. */
async function freshAccessToken(): Promise<string | null> {
  const token = await getAccessToken();
  if (token && !accessTokenStale(token)) return token;
  return refreshSession();
}

export async function POST(request: Request): Promise<NextResponse> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return errorJson('API_URL is not configured.', 500);
  }

  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.includes('multipart/form-data')) {
    return errorJson('Expected multipart/form-data.', 400, 'INVALID_CONTENT_TYPE');
  }

  const token = await freshAccessToken();
  if (!token) {
    return errorJson('Not authenticated.', 401, 'NO_SESSION');
  }

  if (!request.body) {
    return errorJson('Empty request body.', 400, 'FILE_REQUIRED');
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}${BACKEND_UPLOAD_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': contentType, // boundary preserved — do NOT re-encode
        authorization: `Bearer ${token}`,
      },
      body: request.body,
      // undici requires duplex for a streamed request body; absent from the DOM
      // RequestInit lib type Next compiles against, so widen via cast.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream upload failed.';
    return errorJson(message, 502, 'UPSTREAM_UNREACHABLE');
  }

  // Pass the backend envelope (status + JSON) through verbatim so the wizard sees
  // the same {success, data|error} contract it would from a direct call.
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
