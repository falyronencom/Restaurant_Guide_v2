import 'server-only';

import { cookies } from 'next/headers';

import { serverFetch } from '@/lib/api/client';
import {
  ApiError,
  type OAuthLoginData,
  type RefreshData,
  type SessionUser,
} from '@/lib/api/types';

/*
 * Server-only session layer for the web auth foundation (Phase B Slice 1).
 *
 * Responsibilities:
 *   - Own the httpOnly session cookies (access / refresh / display-user) plus
 *     the transient login nonce cookie.
 *   - authedFetch: inject `Authorization: Bearer <access>` on authenticated
 *     backend calls (favorites, logout), transparently refreshing on expiry.
 *   - refreshSession: single-flight refresh honouring the backend's single-use
 *     rotation (reuse trips REFRESH_TOKEN_REUSE_DETECTED → ALL tokens dead).
 *
 * IMPORTANT: cookies().set/.delete are legal ONLY inside a Server Function
 * (action) or Route Handler — never during RSC render (cookies.md:71-73,80-82).
 * Every writer here is therefore only ever reached from a Server Action or Route
 * Handler. Public
 * catalog RSC must NOT import this module: coupling it to cookies() would force
 * those routes out of ISR (cookies.md:69).
 */

// ---------------------------------------------------------------------------
// Cookie names + options
// ---------------------------------------------------------------------------

export const COOKIE_ACCESS = 'rg_at';
export const COOKIE_REFRESH = 'rg_rt';
export const COOKIE_USER = 'rg_user';
export const COOKIE_NONCE = 'g_nonce';
export const COOKIE_YSTATE = 'y_state';

const REFRESH_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days — matches backend refresh TTL
const NONCE_MAX_AGE_S = 60 * 5; // 5 minutes — login round-trip window
const YSTATE_MAX_AGE_S = 60 * 10; // 10 minutes — Yandex authorize round-trip window

/**
 * Secure is env-gated: an unconditional `Secure` cookie is dropped by browsers
 * over http://localhost, silently breaking local-dev login. httpOnly + Path=/
 * + SameSite=Lax are unconditional (Path=/ because Server Actions POST to the
 * page origin, not to /api/auth — a narrower Path would never transmit).
 */
const SECURE = process.env.NODE_ENV === 'production';

type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
};

function cookieOptions(maxAgeSeconds: number): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getAccessToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE_ACCESS)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE_REFRESH)?.value ?? null;
}

/** Display-safe user from the httpOnly rg_user cookie. Never returns tokens. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const raw = (await cookies()).get(COOKIE_USER)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writes (Server Action / Route Handler only)
// ---------------------------------------------------------------------------

export async function writeTokens(
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number,
): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_ACCESS, accessToken, cookieOptions(expiresInSeconds));
  store.set(COOKIE_REFRESH, refreshToken, cookieOptions(REFRESH_MAX_AGE_S));
}

export async function writeUser(user: SessionUser): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_USER, JSON.stringify(user), cookieOptions(REFRESH_MAX_AGE_S));
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_ACCESS);
  store.delete(COOKIE_REFRESH);
  store.delete(COOKIE_USER);
}

export async function setNonce(nonce: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NONCE, nonce, cookieOptions(NONCE_MAX_AGE_S));
}

/** Reads and immediately clears the login nonce (single-use). */
export async function consumeNonce(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NONCE)?.value ?? null;
  if (value) store.delete(COOKIE_NONCE);
  return value;
}

// Yandex authorization-code `state` round-trip (Phase B — Yandex web flow).
// {n} is the single-use CSRF nonce compared against the ?state= query in the
// callback; {r} is the guarded same-origin returnTo. Mirrors g_nonce: httpOnly,
// SameSite=Lax (NOT Strict — Strict drops the cookie on the cross-site
// redirect-back from Yandex), Secure env-gated, single-use consume.
export type YState = { n: string; r: string };

export async function setYState(state: YState): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_YSTATE, JSON.stringify(state), cookieOptions(YSTATE_MAX_AGE_S));
}

/** Reads and immediately clears the Yandex state cookie (single-use). */
export async function consumeYState(): Promise<YState | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_YSTATE)?.value;
  if (!raw) return null;
  store.delete(COOKIE_YSTATE);
  try {
    const parsed = JSON.parse(raw) as Partial<YState>;
    if (typeof parsed.n === 'string' && typeof parsed.r === 'string') {
      return { n: parsed.n, r: parsed.r };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist a backend OAuth login response into the session — web is the cookie
 * issuer (backend returns tokens in the JSON body, never as Set-Cookie). Shared
 * by establishGoogleSession (Server Action) and the Yandex callback Route
 * Handler so there is ONE source of session-write mechanics.
 */
export async function persistOAuthSession(
  data: OAuthLoginData,
): Promise<SessionUser> {
  const user: SessionUser = {
    id: data.user.id,
    email: data.user.email,
    name: data.user.name,
    role: data.user.role,
    avatarUrl: data.user.avatarUrl,
  };
  await writeTokens(data.accessToken, data.refreshToken, data.expiresIn);
  await writeUser(user);
  return user;
}

// ---------------------------------------------------------------------------
// Refresh — single-flight, single-use-rotation-safe
// ---------------------------------------------------------------------------

/*
 * In-process dedupe: concurrent callers presenting the SAME refresh token await
 * ONE backend refresh, so the single-use token is consumed exactly once within
 * this instance. Cross-instance races (multi-tab on a multi-instance deploy)
 * can still trip REFRESH_TOKEN_REUSE_DETECTED — handled by accept-and-recover
 * (clearSession → forced re-login), never an error page.
 */
const inFlightRefresh = new Map<string, Promise<string | null>>();

/** Returns a fresh access token (cookies rotated) or null if the session is dead. */
export async function refreshSession(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const existing = inFlightRefresh.get(refreshToken);
  if (existing) return existing;

  const pending = doRefresh(refreshToken).finally(() => {
    inFlightRefresh.delete(refreshToken);
  });
  inFlightRefresh.set(refreshToken, pending);
  return pending;
}

async function doRefresh(refreshToken: string): Promise<string | null> {
  try {
    const data = await serverFetch<RefreshData>('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    await writeTokens(data.accessToken, data.refreshToken, data.expiresIn);
    // Re-stamp the display-user cookie so its 30-day window tracks activity in
    // lockstep with rg_rt — otherwise rg_user would die at 30d-from-login while
    // rg_rt keeps rolling forward, showing a logged-out header over a live
    // session. RefreshData carries fresh identity (role/name/email) but omits
    // avatarUrl, so MERGE the fresh fields over the existing cookie: a server-side
    // role change (user → partner after the first establishment create, Phase C
    // Slice 1, which forces a refreshSession) then propagates to rg_user, while
    // avatarUrl is preserved from the existing value.
    const existingUser = await getSessionUser();
    if (existingUser) {
      await writeUser({
        ...existingUser,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
      });
    }
    return data.accessToken;
  } catch (err) {
    // Only a definitive auth verdict (401 INVALID_TOKEN/TOKEN_EXPIRED, 403
    // TOKEN_REUSE_DETECTED) means the session is dead → clear. Transient
    // failures (transport/timeout = ApiError(0), 5xx, 429) must NOT discard a
    // still-valid refresh token — return null without clearing so a later
    // attempt can recover.
    const status = err instanceof ApiError ? err.statusCode : 0;
    if (status === 401 || status === 403) {
      await clearSession();
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Authenticated fetch
// ---------------------------------------------------------------------------

async function fetchWithBearer<T>(
  path: string,
  init: RequestInit | undefined,
  accessToken: string,
): Promise<T> {
  return serverFetch<T>(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/**
 * Authenticated backend call. Reachable only from Server Actions or Route
 * Handlers (so the transparent refresh below can legally rotate cookies).
 * Missing/expired access
 * token → refresh once; a 401 from the backend → refresh once and retry.
 * Throws ApiError(401, …, 'NO_SESSION') when there is no recoverable session.
 */
export async function authedFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let accessToken = await getAccessToken();
  let didRefresh = false;
  if (!accessToken) {
    accessToken = await refreshSession();
    didRefresh = true;
    if (!accessToken) {
      throw new ApiError(401, 'Not authenticated', 'NO_SESSION');
    }
  }

  try {
    return await fetchWithBearer<T>(path, init, accessToken);
  } catch (err) {
    // Refresh AT MOST ONCE per call: if we already refreshed for a missing
    // access token, a follow-up 401 is not retried — avoids burning a second
    // single-use rotation on one logical request.
    if (err instanceof ApiError && err.statusCode === 401 && !didRefresh) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return fetchWithBearer<T>(path, init, refreshed);
      }
    }
    throw err;
  }
}
