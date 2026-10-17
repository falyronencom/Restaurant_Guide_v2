import 'server-only';

import { ApiError } from '@/lib/api/types';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/session';

/*
 * Shared media streaming-proxy helper (Phase C Slice 1, Segment B). Forwards a
 * raw multipart upload to a backend path with a server-injected Bearer, without
 * buffering (no formData()/clone()) — the up-to-60MB PDF streams straight
 * through. Used by both the temp-upload proxy (create) and the establishment-
 * scoped proxy (PDF-add-in-edit → POST /:id/media). Composed from session.ts
 * public exports only (the slice keeps session.ts to the additive re-stamp).
 *
 * The access token is refreshed PROACTIVELY (decoded exp) because a consumed
 * stream cannot be retried after a 401.
 */

const EXP_SKEW_MS = 60_000;

function jsonError(message: string, status: number, code?: string): Response {
  return new Response(JSON.stringify({ success: false, error: { message, code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** True when the access JWT is unreadable, expired, or within EXP_SKEW_MS of it. */
function accessTokenStale(token: string): boolean {
  const parts = token.split('.');
  if (parts.length < 2) return true;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 <= Date.now() + EXP_SKEW_MS;
  } catch {
    return true;
  }
}

/**
 * Throws authedFetch's errors when there is no usable token: NO_SESSION for a
 * session that is gone, SESSION_REFRESH_UNAVAILABLE when the refresh got no
 * verdict (cookies intact — «Сессия истекла» would be a lie).
 */
async function freshAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (token && !accessTokenStale(token)) return token;
  return refreshAccessToken();
}

export async function proxyMediaUpload(
  request: Request,
  backendPath: string,
): Promise<Response> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) return jsonError('API_URL is not configured.', 500);

  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.includes('multipart/form-data')) {
    return jsonError('Expected multipart/form-data.', 400, 'INVALID_CONTENT_TYPE');
  }

  let token: string;
  try {
    token = await freshAccessToken();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return jsonError(err.message, err.statusCode, err.errorCode);
  }

  if (!request.body) return jsonError('Empty request body.', 400, 'FILE_REQUIRED');

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}${backendPath}`, {
      method: 'POST',
      headers: {
        'content-type': contentType, // boundary preserved — do NOT re-encode
        authorization: `Bearer ${token}`,
      },
      body: request.body,
      // undici requires duplex for a streamed body; absent from the DOM lib type.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream upload failed.';
    return jsonError(message, 502, 'UPSTREAM_UNREACHABLE');
  }

  // Pass the backend envelope (status + JSON) through verbatim — and the
  // Retry-After of a refusal with it: the account's daily upload allowance
  // (429) names when it renews, in the header and in the body's details.
  const text = await upstream.text();
  const headers: Record<string, string> = {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  };
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers['retry-after'] = retryAfter;
  return new Response(text, { status: upstream.status, headers });
}
