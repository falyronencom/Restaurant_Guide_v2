import { NextResponse } from 'next/server';

/*
 * Geocoding proxy (Phase C Slice 1, Segment B — Decision 3).
 *
 * A server-tier proxy to OpenStreetMap Nominatim for the address-step assist.
 * It MUST be server-side: Nominatim's usage policy requires an identifying
 * User-Agent and ≤1 req/s, neither of which a browser can honour (UA is a
 * forbidden header; throttling can't be coordinated client-side).
 *
 * Ported idiomatically from mobile geocoding_service.dart (countrycodes=by,
 * limit 1, last-query cache) — NOT a Flutter calque. lat/lng remain the
 * editable canon (on-site/data-sheet); this is assist only (Decision 3).
 *
 * Best-effort throttle + cache are per-instance: on a multi-instance deploy the
 * aggregate rate may exceed 1 rps, acceptable for a low-volume assist. Negative
 * results are cached too, so repeated misses don't hammer Nominatim.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'NirivioRestaurantGuide/1.0 (+https://nirivio.by)';
const MIN_INTERVAL_MS = 1100; // ~1 rps (policy is ≤1 rps; a little headroom)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const MIN_QUERY_LEN = 3;

type GeocodeHit = { lat: number; lng: number; display_name: string };

const cache = new Map<string, { value: GeocodeHit | null; at: number }>();
let lastCallAt = 0;
let chain: Promise<void> = Promise.resolve();

/** Serialise outbound calls and space them ≥ MIN_INTERVAL_MS apart. */
function throttle(): Promise<void> {
  chain = chain.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallAt = Date.now();
  });
  return chain;
}

export async function GET(request: Request): Promise<NextResponse> {
  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q || q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ result: null });
  }

  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ result: cached.value });
  }

  await throttle();

  let hit: GeocodeHit | null = null;
  try {
    const url =
      `${NOMINATIM}?format=jsonv2&countrycodes=by&limit=1` +
      `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru' },
    });
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
      }>;
      if (Array.isArray(rows) && rows.length > 0) {
        const lat = parseFloat(rows[0].lat);
        const lng = parseFloat(rows[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          hit = { lat, lng, display_name: rows[0].display_name };
        }
      }
    }
  } catch {
    hit = null; // assist failure is non-fatal — the partner hand-enters lat/lng
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value: hit, at: Date.now() });

  return NextResponse.json({ result: hit });
}
