'use server';

import { serverFetch } from '@/lib/api/client';
import { ApiError, type OAuthLoginData, type SessionUser } from '@/lib/api/types';
import {
  clearSession,
  consumeNonce,
  getAccessToken,
  getRefreshToken,
  getSessionUser,
  refreshSession,
  setNonce,
  writeTokens,
  writeUser,
} from '@/lib/auth/session';

/*
 * Auth Server Actions (Phase B Slice 1). All state-changing operations are
 * Server Actions — Next 16 gives them automatic POST-only + Origin/Host CSRF
 * defense (data-security.md), which Route Handlers do NOT inherit. This is the
 * resolution of DECISION #5 (CSRF): no proxy.ts / middleware.ts needed.
 *
 * The backend is FROZEN for Google (zero changes). The web tier is the cookie
 * issuer: the backend returns tokens in the JSON body, never as Set-Cookie.
 */

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; code: string; message: string };

/**
 * Mint a single-use login nonce, store it in a short-lived httpOnly cookie, and
 * return it so the GIS island can pass it into google.accounts.id.initialize.
 * The nonce is embedded in the issued id_token and verified in
 * establishGoogleSession — this closes login-CSRF at the web tier, since the
 * frozen backend does not verify the nonce claim.
 */
export async function prepareLogin(): Promise<{ nonce: string }> {
  const nonce = crypto.randomUUID();
  await setNonce(nonce);
  return { nonce };
}

/**
 * Exchange a Google id_token for an app session. Verifies the nonce round-trip,
 * POSTs the id_token to the unchanged backend /oauth, then sets the httpOnly
 * session cookies and the display-user cookie.
 */
export async function establishGoogleSession(
  idToken: string,
): Promise<LoginResult> {
  // 1. Web-tier nonce enforcement (single-use). The frozen backend does not
  //    check the nonce claim, so the binding is enforced here.
  const expectedNonce = await consumeNonce();
  const tokenNonce = readNonceClaim(idToken);
  if (!expectedNonce || !tokenNonce || tokenNonce !== expectedNonce) {
    return {
      ok: false,
      code: 'NONCE_MISMATCH',
      message: 'Не удалось подтвердить вход. Попробуйте ещё раз.',
    };
  }

  // 2. Exchange the id_token (request field is literally `token`).
  let data: OAuthLoginData;
  try {
    data = await serverFetch<OAuthLoginData>('/api/v1/auth/oauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', token: idToken }),
    });
  } catch (err) {
    return mapAuthError(err);
  }

  // 3. Persist the session (web is the cookie issuer).
  const user: SessionUser = {
    id: data.user.id,
    email: data.user.email,
    name: data.user.name,
    role: data.user.role,
    avatarUrl: data.user.avatarUrl,
  };
  await writeTokens(data.accessToken, data.refreshToken, data.expiresIn);
  await writeUser(user);
  return { ok: true, user };
}

/**
 * Read the current session's display user (for AuthProvider hydration on mount
 * / reload). Silently restores the access token via refresh if it expired but a
 * refresh token remains. Returns null when there is no recoverable session.
 */
export async function getSessionSummary(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const access = await getAccessToken();
  if (!access) {
    const restored = await refreshSession();
    if (!restored) {
      await clearSession();
      return null;
    }
  }
  return user;
}

/**
 * Revoke the session. Best-effort server-side revocation requires BOTH the
 * Bearer access header AND the refreshToken body; the local cookie clear is
 * unconditional so logout never wedges on a backend failure or expired access.
 */
export async function logoutAction(): Promise<void> {
  let accessToken = await getAccessToken();
  // If the access token has expired (common after the 4h TTL) but a refresh
  // token remains, mint a fresh access token FIRST — the backend logout requires
  // a Bearer, so otherwise the 30-day refresh token would never be revoked
  // server-side (it would live until its natural expiry).
  if (!accessToken) {
    accessToken = await refreshSession();
  }
  // Re-read the refresh token AFTER any rotation so we revoke the token the
  // session currently holds (single-use rotation changes it).
  const refreshToken = await getRefreshToken();

  if (accessToken && refreshToken) {
    try {
      await serverFetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Non-fatal: the local cookie clear below logs the user out of the web session.
    }
  }
  await clearSession();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode the `nonce` claim from a JWT payload WITHOUT verifying the signature.
 * Signature/iss/aud/exp validation is the backend's job; here we only confirm
 * the token was issued for THIS login attempt (replay / login-CSRF defense).
 */
function readNonceClaim(idToken: string): string | null {
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as { nonce?: unknown };
    return typeof payload.nonce === 'string' ? payload.nonce : null;
  } catch {
    return null;
  }
}

function mapAuthError(err: unknown): LoginResult {
  if (err instanceof ApiError) {
    return {
      ok: false,
      code: err.errorCode ?? `HTTP_${err.statusCode}`,
      message: messageForCode(err.errorCode, err.statusCode),
    };
  }
  return {
    ok: false,
    code: 'NETWORK',
    message: 'Сеть недоступна. Попробуйте позже.',
  };
}

function messageForCode(code: string | undefined, status: number): string {
  switch (code) {
    case 'INVALID_TOKEN':
      return 'Не удалось войти через Google. Попробуйте ещё раз.';
    case 'OAUTH_NO_EMAIL':
      return 'В аккаунте Google нет адреса электронной почты.';
    case 'OAUTH_EMAIL_NOT_VERIFIED':
      return 'Email в аккаунте Google не подтверждён.';
    case 'ACCOUNT_DEACTIVATED':
      return 'Этот аккаунт деактивирован.';
    case 'ACCOUNT_CONFLICT':
      return 'Аккаунт с этим провайдером уже существует.';
    default:
      if (status === 429) return 'Слишком много попыток входа. Попробуйте позже.';
      return 'Не удалось войти. Попробуйте позже.';
  }
}
