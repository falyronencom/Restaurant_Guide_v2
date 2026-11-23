import 'server-only';

import { COOKIE_ACCESS, COOKIE_REFRESH } from '@/lib/auth/session';

/*
 * What a partner Route Handler checks of a request before it reads the body
 * (Phase 4.5 of part 1 of «Кабинет партнёра на сайте», P2 3): the edit of a
 * menu line read its body whole before anything told it that a session was
 * there at all — outside a browser Origin is whatever the caller writes, and
 * the one instance of the site could be made to buffer bodies without bound.
 */

/** The request carries a session cookie the API could take (the access token, or the refresh one). */
export function hasSessionCookie(request: Request): boolean {
  const header = request.headers.get('cookie');
  if (!header) return false;
  return header.split(';').some((part) => {
    const eq = part.indexOf('=');
    if (eq < 0) return false;
    const name = part.slice(0, eq).trim();
    return (name === COOKIE_ACCESS || name === COOKIE_REFRESH) && part.slice(eq + 1).trim() !== '';
  });
}

/**
 * The body as text, read up to `maxBytes`; null — longer than that, by its
 * Content-Length or as it streams (a body sent without a length is read no
 * further than the bound).
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const stream = request.body;
  if (!stream) {
    const text = await request.text();
    return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
