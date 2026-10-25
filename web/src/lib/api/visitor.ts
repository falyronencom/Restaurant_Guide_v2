import 'server-only';

import { isIP } from 'node:net';

import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

/*
 * Who the site's request to the API is made for (registry v4.35, v4.44;
 * directive D5, 25.10.2026).
 *
 * The site calls the API from its own server, so to the API every visitor is
 * one address — the site's — and its limits count the whole site as one
 * person: ten wrong passwords anywhere lock everyone out of signing in for a
 * minute, twenty new phrases an hour end the smart search for all. So the
 * site proves the request is its own with a secret both services hold
 * (SITE_REQUEST_SECRET — server-only, never NEXT_PUBLIC_) and names the
 * visitor in a header of its own; the API trusts the visitor only with the
 * secret (backend middleware/siteVisitor.js).
 *
 * The visitor is passed EXPLICITLY, and only from where a visitor's request
 * exists: Server Actions and force-dynamic pages (`headers()` — see
 * currentVisitor), Route Handlers (`request.headers`). Never implicitly inside
 * serverFetch: `headers()` there would turn the ISR pages (home, the public
 * layout, the detail) dynamic, and the detail into a 500 under `next start`
 * (the searchParams precedent of 19.06). Never from a Server Action's
 * arguments: the browser sends those. Requests without a visitor — ISR,
 * sitemap, background revalidation — still carry the secret and count as the
 * site's own, its own budget on the API.
 */

export const SITE_SECRET_HEADER = 'X-Site-Secret';
export const SITE_VISITOR_HEADER = 'X-Site-Visitor';

/** The API ignores a shorter secret (siteVisitor.js MIN_SECRET_LENGTH). */
const MIN_SECRET_LENGTH = 32;

/** Railway's edge chain: the visitor, then one hop of Railway's own. */
const DEFAULT_TRUSTED_HOPS = 2;
const MAX_TRUSTED_HOPS = 3;

type HeaderSource = { get(name: string): string | null };

/** process.env or a stand-in. */
type Env = Record<string, string | undefined>;

/**
 * How many entries at the right end of X-Forwarded-For are Railway's own,
 * the socket included — the API's own rule (backend config/trustProxy.js,
 * PR #138, after the probe of 25.10.2026). SITE_TRUST_PROXY_HOPS, 1–3,
 * default 2; a malformed value is 1, which no forged chain can pass. If the
 * site is ever put behind Railway's CDN or Cloudflare, the probe is repeated
 * first: a CDN adds a hop.
 */
export function trustedHops(env: Env = process.env): number {
  const raw = env.SITE_TRUST_PROXY_HOPS?.trim();
  if (!raw) return DEFAULT_TRUSTED_HOPS;
  if (!/^\d+$/.test(raw)) return 1;
  const hops = Number(raw);
  return hops >= 1 && hops <= MAX_TRUSTED_HOPS ? hops : 1;
}

/**
 * The visitor's address from the edge's headers, or null. Like Express's
 * `trust proxy N`: the socket is the first trusted hop and the right-most
 * N−1 entries the others, so the visitor is the N-th entry from the right
 * (with 2: `visitor, hop` → visitor); with fewer entries, the leftmost.
 * X-Real-IP is not read: whether the edge rewrites it on this path is not
 * known.
 */
export function visitorAddressFrom(
  headers: HeaderSource | null | undefined,
  env: Env = process.env,
): string | null {
  const chain = (headers?.get?.('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length === 0) return null;
  const candidate = chain[Math.max(0, chain.length - trustedHops(env))];
  return candidate.length <= 64 && isIP(candidate) !== 0 ? candidate : null;
}

/**
 * The visitor of the request being served — for Server Actions and
 * force-dynamic pages only (headers() is the request's; it throws outside
 * one, and then there is no visitor). Not for ISR code: see the module note.
 */
export async function currentVisitor(): Promise<string | null> {
  try {
    return visitorAddressFrom(await headers());
  } catch (err) {
    // Next's own signals (a static render bailing out to dynamic) are not
    // «no visitor»: swallowed, an ISR page calling this by mistake would
    // render without the signal instead of failing the build loudly. The
    // optional call: test files that mock next/navigation leave it out.
    unstable_rethrow?.(err);
    return null;
  }
}

/**
 * The headers every request of the site to the API carries: the secret when
 * one is set, and the visitor when there is one. Without a usable secret, no
 * header at all — the API would ignore an unproven visitor anyway.
 */
export function siteRequestHeaders(
  visitor: string | null | undefined,
  env: Env = process.env,
): Record<string, string> {
  const secret = env.SITE_REQUEST_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return {};
  return visitor
    ? { [SITE_SECRET_HEADER]: secret, [SITE_VISITOR_HEADER]: visitor }
    : { [SITE_SECRET_HEADER]: secret };
}
