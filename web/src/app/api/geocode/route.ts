import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { serverFetch } from '@/lib/api/client';
import { visitorAddressFrom } from '@/lib/api/visitor';
import { getAccessToken } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/partner/same-origin';

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
 * Who may ask (thread «Расходы посторонних», point 4, 03.11.2026): the assist
 * lives only in the cabinet's card wizard, so only a signed-in person reaches
 * it — like the cabinet's own handlers, a same-origin POST with the session
 * cookie, the token checked by the API (GET /auth/me, remembered for
 * SESSION_TTL_MS) and counted against the visitor's address there. Then an
 * hourly allowance per account, a bounded wait line, a bounded query and an
 * outbound call bounded in time. Until then anyone could call it, with a
 * query of any length, and the wait line grew without end. The assist stays
 * optional: without it the card takes the city centre.
 *
 * Throttle, cache, allowances and the line are per-instance: on a
 * multi-instance deploy the aggregate rate may exceed 1 rps, acceptable for
 * a low-volume assist. A miss Nominatim answered is cached; a failed call is
 * not — it is not «no such address».
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'NirivioRestaurantGuide/1.0 (+https://nirivio.by)';
const MIN_INTERVAL_MS = 1100; // ~1 rps (policy is ≤1 rps; a little headroom)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const MIN_QUERY_LEN = 3;
/** City, street and building joined — a long Belarusian address is under 100. */
export const MAX_QUERY_LEN = 200;
/** Calls waiting for their turn at most; past it the assist is busy (503). */
export const MAX_WAITING = 10;
/** Nominatim's answer is awaited this long, then the call counts as failed. */
const UPSTREAM_TIMEOUT_MS = 5000;
/** Per account and hour — a card's address is looked up a few times. */
export const HOURLY_PER_ACCOUNT = 30;
const HOUR_MS = 60 * 60 * 1000;
const SESSION_TTL_MS = 5 * 60 * 1000;
const SESSION_CACHE_MAX = 500;
const MAX_BODY_BYTES = 4096;

type GeocodeHit = { lat: number; lng: number; display_name: string };
type Refusal = 'NO_SESSION' | 'RATE_LIMITED' | 'BUSY' | 'TOO_LONG' | 'UNAVAILABLE';

const cache = new Map<string, { value: GeocodeHit | null; at: number }>();
const inFlight = new Map<string, Promise<GeocodeHit | null | undefined>>();
const sessions = new Map<string, { userId: string; at: number }>();
const allowances = new Map<string, { start: number; count: number }>();
let lastCallAt = 0;
let waiting = 0;
let chain: Promise<void> = Promise.resolve();

const STATUS: Record<Refusal, number> = {
  NO_SESSION: 401,
  RATE_LIMITED: 429,
  BUSY: 503,
  TOO_LONG: 400,
  UNAVAILABLE: 503,
};

function refuse(code: Refusal): Response {
  return NextResponse.json({ result: null, code }, { status: STATUS[code] });
}

/** Serialise outbound calls and space them ≥ MIN_INTERVAL_MS apart. */
function throttle(): Promise<void> {
  chain = chain.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallAt = Date.now();
  });
  return chain;
}

/** Drop the oldest entry of a Map kept in insertion order once it is full. */
function trim<V>(map: Map<string, V>, max: number): void {
  if (map.size < max) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

/**
 * The account behind the access token, or null when the API refuses it.
 * Throws when the API could not be asked — the caller answers UNAVAILABLE.
 */
async function accountOf(token: string, request: Request): Promise<string | null> {
  const key = createHash('sha256').update(token).digest('hex');
  const known = sessions.get(key);
  if (known && Date.now() - known.at < SESSION_TTL_MS) return known.userId;
  try {
    const data = await serverFetch<{ user: { id: string } }>(
      '/api/v1/auth/me',
      { headers: { Authorization: `Bearer ${token}` } },
      { visitor: visitorAddressFrom(request.headers), timeoutMs: UPSTREAM_TIMEOUT_MS },
    );
    const userId = data?.user?.id;
    if (typeof userId !== 'string' || userId === '') return null;
    trim(sessions, SESSION_CACHE_MAX);
    sessions.set(key, { userId, at: Date.now() });
    return userId;
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 401 || status === 403 || status === 404) return null;
    throw err;
  }
}

/** One slot of the account's hourly allowance; false when it is spent. */
function takeAllowance(userId: string): boolean {
  const now = Date.now();
  const entry = allowances.get(userId);
  if (!entry || now - entry.start >= HOUR_MS) {
    trim(allowances, SESSION_CACHE_MAX);
    allowances.set(userId, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= HOURLY_PER_ACCOUNT;
}

/**
 * Ask Nominatim, in turn. Resolves to the hit, to null when Nominatim found
 * nothing, or to undefined when the call failed (not cached).
 */
async function lookUp(q: string, key: string): Promise<GeocodeHit | null | undefined> {
  waiting += 1;
  try {
    await throttle();
  } finally {
    waiting -= 1;
  }

  let hit: GeocodeHit | null | undefined;
  try {
    const url =
      `${NOMINATIM}?format=jsonv2&countrycodes=by&limit=1` +
      `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const rows = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    hit = null;
    if (Array.isArray(rows) && rows.length > 0) {
      const lat = parseFloat(rows[0].lat);
      const lng = parseFloat(rows[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        hit = { lat, lng, display_name: rows[0].display_name };
      }
    }
  } catch {
    return undefined; // assist failure is non-fatal — the partner hand-enters lat/lng
  }

  trim(cache, CACHE_MAX);
  cache.set(key, { value: hit, at: Date.now() });
  return hit;
}

async function readQuery(request: Request): Promise<string | null> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    return null;
  }
  try {
    const body = (await request.json()) as { q?: unknown };
    return typeof body?.q === 'string' ? body.q.trim() : '';
  } catch {
    return '';
  }
}

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const token = await getAccessToken();
  if (!token) return refuse('NO_SESSION');

  const q = await readQuery(request);
  if (q === null || q.length > MAX_QUERY_LEN) return refuse('TOO_LONG');
  if (q.length < MIN_QUERY_LEN) return NextResponse.json({ result: null });

  let userId: string | null;
  try {
    userId = await accountOf(token, request);
  } catch {
    return refuse('UNAVAILABLE');
  }
  if (!userId) return refuse('NO_SESSION');

  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ result: cached.value });
  }

  if (!takeAllowance(userId)) return refuse('RATE_LIMITED');

  let pending = inFlight.get(key);
  if (!pending) {
    if (waiting >= MAX_WAITING) return refuse('BUSY');
    if (request.signal?.aborted) return refuse('UNAVAILABLE');
    pending = lookUp(q, key).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  const hit = await pending;
  if (hit === undefined) return refuse('UNAVAILABLE');
  return NextResponse.json({ result: hit });
}

/** Test-only: forget every per-instance state between cases. */
export function _resetForTests(): void {
  cache.clear();
  inFlight.clear();
  sessions.clear();
  allowances.clear();
  lastCallAt = 0;
  waiting = 0;
  chain = Promise.resolve();
}
