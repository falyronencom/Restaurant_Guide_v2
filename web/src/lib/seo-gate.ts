import 'server-only';

/**
 * SEO Gate — single source of truth for NOINDEX_MODE + SITE_URL env vars.
 *
 * Controls three SEO surface layers in lockstep, all reading process.env at
 * module load (build-time for static routes — Next 16 Route Handlers are
 * cached by default):
 *
 *   1. `robots.ts`        — User-Agent rules + sitemap reference inclusion
 *   2. `sitemap.ts`       — empty array (gated) vs full enumeration (open)
 *   3. root `layout.tsx`  — metadata.robots index/follow (defense-in-depth)
 *
 * Flip path: change env var on the deploy platform → redeploy → all three
 * layers re-evaluate consistently. `force-dynamic` is NOT used — launch is
 * an intentional redeploy event (Discovery Q8b SR).
 *
 * Fail-safe to noindex: any value other than the literal string 'false'
 * (case-insensitive) leaves the gate engaged. Unset env var → gated.
 *
 * `SITE_URL` is required for absolute-URL emission (sitemap URLs, OG
 * absolute images, canonical promotion via metadataBase). No NEXT_PUBLIC_
 * prefix — SEO rendering happens server-side; client bundles do not need it.
 */

const DEV_FALLBACK_SITE_URL = 'http://localhost:3000';

/**
 * Returns true when the site should NOT be indexed (gate engaged).
 *
 * Default ON — must be explicitly disabled via `NOINDEX_MODE=false` on the
 * deploy platform. Read once at module load.
 */
export function isNoIndexMode(): boolean {
  const raw = process.env.NOINDEX_MODE;
  if (raw == null) return true;
  return raw.toLowerCase() !== 'false';
}

/**
 * Returns the canonical site base URL without trailing slash.
 *
 * Production: throws if `SITE_URL` is unset — hard-fail forces explicit
 * configuration on the deploy platform before launch (sitemap absolute URLs,
 * metadataBase, OG image fallback all depend on it).
 *
 * Development: falls back to `http://localhost:3000` so `next dev` and
 * `next build` work without manual env setup.
 */
export function getSiteUrl(): string {
  const raw = process.env.SITE_URL;
  if (raw && raw.length > 0) return raw.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SITE_URL env var is not set. Add it to your deploy platform (Vercel/Railway) settings — required for sitemap absolute URLs and metadataBase.',
    );
  }
  return DEV_FALLBACK_SITE_URL;
}

/**
 * Promote a relative path or already-absolute URL into an absolute URL
 * anchored at `SITE_URL`. Idempotent on already-absolute http(s) URLs.
 */
export function toAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = getSiteUrl();
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}
