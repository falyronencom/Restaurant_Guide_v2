'use server';

import { redirect } from 'next/navigation';

import { serverFetch } from '@/lib/api/client';
import {
  sendVerificationCode,
  verifyEmailCode,
} from '@/lib/api/endpoints/verification';
import {
  ApiError,
  type LoginData,
  type OAuthLoginData,
  type PasswordResetMessageData,
  type RegisterData,
  type SessionUser,
} from '@/lib/api/types';
import { messageForCode } from '@/lib/auth/errors';
import {
  clearSession,
  consumeNonce,
  getAccessToken,
  getRefreshToken,
  getSessionUser,
  persistOAuthSession,
  refreshSession,
  setNonce,
  setYState,
} from '@/lib/auth/session';
import { buildAuthorizeUrl, guardReturnTo } from '@/lib/auth/yandex';

/*
 * Auth Server Actions (Phase B Slice 1). All state-changing operations are
 * Server Actions — Next 16 gives them automatic POST-only + Origin/Host CSRF
 * defense (data-security.md), which Route Handlers do NOT inherit. This is the
 * resolution of DECISION #5 (CSRF): no proxy.ts / middleware.ts needed.
 *
 * The backend is FROZEN for Google (zero changes). The web tier is the cookie
 * issuer: the backend returns tokens in the JSON body, never as Set-Cookie.
 *
 * DECISION #6 (Phase B — Yandex web flow): Yandex login is redirect-based, so
 * its *callback* must be a Route Handler — the one surface OUTSIDE the
 * DECISION #5 CSRF model. We keep that exposure minimal: only the callback is a
 * Route Handler (its CSRF is the OAuth `state` round-trip via the y_state
 * cookie); *initiation* stays a Server Action (startYandexLogin below), inside
 * the POST-only + Origin/Host model. The frozen backend is untouched — the
 * callback exchanges the code for a Yandex access_token web-side and calls the
 * SAME POST /auth/oauth {provider:'yandex', token} contract mobile uses.
 */

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; code: string; message: string };

/**
 * useActionState shape for the email/password forms (Slice 2). `null` is the
 * initial state (no submission yet). On success the form island applies `user`
 * into the AuthProvider context; navigation to `returnTo` is client-side
 * (AuthRedirect) because a server redirect() would leave the root-layout
 * AuthProvider stale — it never remounts on soft navigation.
 */
export type AuthFormState =
  // `returnTo` in the ok-branch is the action's own guard verdict — pinned by
  // tests as the observable output of guardReturnTo(formData). Navigation
  // intentionally does NOT consume it: AuthRedirect navigates with the
  // page-level guarded prop, the single path shared with the Google flow
  // (which has no form state). Keep the hidden inputs sourced from the page
  // prop so the two stay the same value.
  | { ok: true; user: SessionUser; returnTo: string }
  | AuthFormError
  | null;

/** Error branch shared by every email/password form action (login, register,
 *  forgot/reset password) — extracted so the password flows reuse mapFormError
 *  without inheriting the session-carrying ok-branch. */
export type AuthFormError = {
  ok: false;
  code: string;
  message: string;
  /** Per-field Russian texts keyed by input name (email/password/name). */
  fieldErrors?: Record<string, string>;
  /**
   * Entered values echoed back so the form can repopulate after React 19's
   * post-action uncontrolled-form reset (inputs re-read defaultValue on the
   * error re-render). The password is deliberately NEVER echoed — this
   * state travels through the RSC payload.
   */
  values?: { name?: string; email?: string };
};

/**
 * useActionState shape for the forgot/reset password forms. No session is
 * created, so the ok-branch carries only the fixed Russian confirmation the
 * island renders in place of the form.
 */
export type PasswordFormState =
  | { ok: true; message: string }
  | AuthFormError
  | null;

/**
 * useActionState shape for the verify-email code form (email-channel Slice 2).
 * The ok-branch carries nothing — Decision V «screen only»: the island renders
 * its own terminal confirmation and the session is deliberately NOT re-stamped
 * (no SessionUser.emailVerified until the deferred session-wiring increment).
 * `values.code` echoes the entered code after React 19's post-action reset —
 * a 6-digit verification code is low-sensitivity, unlike passwords.
 */
export type VerifyEmailFormState =
  | { ok: true }
  | { ok: false; code: string; message: string; values?: { code?: string } }
  | null;

/** useActionState shape for the resend-code button (its own tiny form). */
export type ResendCodeState =
  | { ok: true; message: string }
  | { ok: false; code: string; message: string }
  | null;

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

  // 3. Persist the session (web is the cookie issuer) — shared with the Yandex
  //    callback via persistOAuthSession (single source of session-write logic).
  const user = await persistOAuthSession(data);
  return { ok: true, user };
}

/**
 * Initiate the Yandex authorization-code flow (DECISION #6). A Server Action —
 * NOT a Route Handler — so initiation stays inside Next 16's POST-only +
 * Origin/Host CSRF model. Mints a single-use `state` nonce, stores {n, r} in the
 * httpOnly y_state cookie, then redirects the browser to Yandex.
 *
 * `redirect()` throws NEXT_REDIRECT, so it is called on the straight-line path
 * (never inside try/catch). Invoked via <form action> from AuthMenu; `returnTo`
 * arrives as form data and is guarded to a same-origin relative path.
 */
export async function startYandexLogin(formData: FormData): Promise<void> {
  const returnTo = guardReturnTo(formData.get('returnTo')?.toString());
  const nonce = crypto.randomUUID();
  await setYState({ n: nonce, r: returnTo });
  redirect(buildAuthorizeUrl(nonce));
}

/**
 * Email/password registration (Slice 2, useActionState signature). Pre-checks
 * mirror the backend rules for instant feedback, but the backend 422 remains
 * the canon — anything passing here and failing there maps per-field via
 * mapFormError. Web registration is email-only: no `phone`, authMethod fixed.
 * The register response omits avatarUrl/lastLoginAt, so it is widened to the
 * OAuthLoginData shape to reuse the single session-persist path.
 */
export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = (formData.get('name')?.toString() ?? '').trim();
  const email = (formData.get('email')?.toString() ?? '').trim();
  const password = formData.get('password')?.toString() ?? '';
  const returnTo = guardReturnTo(formData.get('returnTo')?.toString());

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 100) {
    fieldErrors.name = FIELD_TEXTS_RU.name;
  }
  if (!EMAIL_RE.test(email)) {
    fieldErrors.email = FIELD_TEXTS_RU.email;
  }
  if (!isCompliantPassword(password)) {
    fieldErrors.password = FIELD_TEXTS_RU.password;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: VALIDATION_SUMMARY_RU,
      fieldErrors,
      values: { name, email },
    };
  }

  let data: RegisterData;
  try {
    data = await serverFetch<RegisterData>('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, authMethod: 'email' }),
    });
  } catch (err) {
    return mapFormError(err, { name, email });
  }

  const user = await persistOAuthSession({
    ...data,
    user: { ...data.user, avatarUrl: null, lastLoginAt: null },
  });
  return { ok: true, user, returnTo };
}

/**
 * Email/password login (Slice 2, useActionState signature). No complexity
 * pre-check on the password (it is an existing credential, mirroring the
 * backend's validateLogin); the 401 INVALID_CREDENTIALS mapping stays generic —
 * the backend deliberately does not reveal whether the email exists.
 */
export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = (formData.get('email')?.toString() ?? '').trim();
  const password = formData.get('password')?.toString() ?? '';
  const returnTo = guardReturnTo(formData.get('returnTo')?.toString());

  const fieldErrors: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) {
    fieldErrors.email = FIELD_TEXTS_RU.email;
  }
  if (password.length === 0) {
    fieldErrors.password = 'Введите пароль.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: VALIDATION_SUMMARY_RU,
      fieldErrors,
      values: { email },
    };
  }

  let data: LoginData;
  try {
    data = await serverFetch<LoginData>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    return mapFormError(err, { email });
  }

  const user = await persistOAuthSession(data);
  return { ok: true, user, returnTo };
}

/**
 * Request a password reset email (useActionState signature). The backend is
 * enumeration-safe by contract (always the same 200), so the ok-branch text is
 * the SAME fixed generic message for every outcome — this action must never
 * become a way to probe whether an email is registered. Only transport-level
 * failures (network, 429, 5xx) surface as errors.
 */
export async function forgotPasswordAction(
  _prevState: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const email = (formData.get('email')?.toString() ?? '').trim();

  if (!EMAIL_RE.test(email)) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: VALIDATION_SUMMARY_RU,
      fieldErrors: { email: FIELD_TEXTS_RU.email },
      values: { email },
    };
  }

  try {
    await serverFetch<PasswordResetMessageData>('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch (err) {
    return mapFormError(err, { email });
  }

  return { ok: true, message: FORGOT_SENT_RU };
}

/**
 * Set a new password with the token from the emailed link (useActionState
 * signature). The token arrives via a hidden input sourced from the page's
 * awaited `?token=` search param. Password complexity pre-check mirrors
 * register; the backend 422 remains the canon. On success the backend has
 * revoked every session of the user — the island shows a login link.
 */
export async function resetPasswordAction(
  _prevState: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const token = formData.get('token')?.toString() ?? '';
  const password = formData.get('password')?.toString() ?? '';

  if (token.length === 0) {
    return {
      ok: false,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: messageForCode('INVALID_OR_EXPIRED_TOKEN', 410),
    };
  }

  if (!isCompliantPassword(password)) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: VALIDATION_SUMMARY_RU,
      fieldErrors: { password: FIELD_TEXTS_RU.password },
    };
  }

  try {
    await serverFetch<PasswordResetMessageData>('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
  } catch (err) {
    return mapFormError(err, {});
  }

  return { ok: true, message: RESET_DONE_RU };
}

/**
 * Verify the 6-digit email code (email-channel Slice 2, useActionState
 * signature). Authed mutation → authedFetch boundary (via the verification
 * endpoints wrapper), NOT serverFetch. The shape pre-check mirrors the
 * backend's inline 400 INVALID_REQUEST (this route never emits a 422, so no
 * details parsing). UX footgun pinned by the backend tests: after 5 wrong
 * tries the 6th call returns 410 INVALID_OR_EXPIRED_CODE — its Russian text
 * says «запросите новый», not «слишком много попыток».
 */
export async function verifyEmailCodeAction(
  _prevState: VerifyEmailFormState,
  formData: FormData,
): Promise<VerifyEmailFormState> {
  const code = (formData.get('code')?.toString() ?? '').trim();

  if (!/^\d{6}$/.test(code)) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: messageForCode('INVALID_REQUEST', 400),
      values: { code },
    };
  }

  try {
    await verifyEmailCode(code);
  } catch (err) {
    return mapVerifyError(err, { code });
  }

  return { ok: true };
}

/**
 * Re-send the verification code (email-channel Slice 2, useActionState
 * signature — no fields). `sent:false` (Resend unconfigured) deliberately gets
 * the same confirmation: the code row exists either way, and the difference is
 * infrastructure state the user cannot act on. Backend throttles: 5/hour/user
 * service-side (RATE_LIMITED) + 10/hour route limiter (RATE_LIMIT_EXCEEDED);
 * a new code invalidates all prior active ones.
 */
export async function resendVerificationCodeAction(
  _prevState: ResendCodeState,
  _formData: FormData,
): Promise<ResendCodeState> {
  try {
    await sendVerificationCode();
  } catch (err) {
    return mapVerifyError(err, undefined);
  }

  return { ok: true, message: RESEND_SENT_RU };
}

/**
 * Read the current session's display user (for AuthProvider hydration on mount
 * / reload). Silently restores the access token via refresh if it expired but a
 * refresh token remains. Returns null when there is no recoverable session.
 */
export async function getSessionSummary(): Promise<SessionUser | null> {
  // Pure read of the display-user cookie — NO token refresh here. Refreshing on
  // every (possibly passive) page load would rotate the single-use refresh
  // token needlessly and widen the cross-instance reuse race. Refresh is lazy:
  // it happens in authedFetch when an authenticated action actually runs.
  // rg_user and rg_rt share a 30-day window (re-stamped together on refresh),
  // so rg_user presence reliably reflects a live session.
  return getSessionUser();
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

// --- Email/password form helpers (Slice 2) ---------------------------------

/**
 * Russian per-field texts. One text per field stating its full requirements —
 * shown both by the pre-check and by the backend-422 mapping, so the user sees
 * identical wording regardless of which layer rejected the value (backend
 * validator texts are English and never surface in the UI).
 */
const FIELD_TEXTS_RU = {
  name: 'Имя: от 2 до 100 символов — буквы, пробелы, дефисы, апострофы.',
  email: 'Введите корректный email.',
  password: 'Пароль: минимум 8 символов, заглавная и строчная буквы, цифра.',
} as const;

const VALIDATION_SUMMARY_RU = 'Проверьте правильность заполнения полей.';

/** Enumeration-safe by design: one fixed text for every forgot outcome. */
const FORGOT_SENT_RU =
  'Если такой email зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля.';

const RESET_DONE_RU = 'Пароль изменён. Войдите с новым паролем.';

const RESEND_SENT_RU = 'Мы отправили новый код на вашу почту.';

/** Light-touch shape check; the backend's isEmail stays the canon. */
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Mirrors backend validateRegister: ≥8 chars + uppercase + lowercase + digit. */
function isCompliantPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

/**
 * Map a register/login failure into AuthFormState. 422 VALIDATION_ERROR maps
 * per-field through FIELD_TEXTS_RU (fields outside the dictionary fall back to
 * the summary message only); everything else routes through messageForCode.
 * `values` (never the password) is echoed for the post-reset repopulation.
 */
function mapFormError(
  err: unknown,
  values: { name?: string; email?: string },
): AuthFormError {
  if (err instanceof ApiError) {
    if (err.errorCode === 'VALIDATION_ERROR') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: VALIDATION_SUMMARY_RU,
        fieldErrors: mapValidationDetails(err.details),
        values,
      };
    }
    return {
      ok: false,
      code: err.errorCode ?? `HTTP_${err.statusCode}`,
      message: messageForCode(err.errorCode, err.statusCode),
      values,
    };
  }
  return {
    ok: false,
    code: 'NETWORK',
    message: 'Сеть недоступна. Попробуйте позже.',
    values,
  };
}

/**
 * Map a verify/resend failure into the error branch shared by both verify-email
 * actions. The user-reachable codes are covered by messageForCode
 * (INVALID_CODE, INVALID_OR_EXPIRED_CODE, TOO_MANY_ATTEMPTS, RATE_LIMITED,
 * RATE_LIMIT_EXCEEDED, NO_EMAIL, EMAIL_ALREADY_VERIFIED, INVALID_REQUEST,
 * NO_SESSION) — guarded by auth-errors.test.ts. 404 USER_NOT_FOUND (deleted
 * account mid-session) deliberately rides the neutral fallback. `values`
 * echoes the entered code (verify form only; resend has no fields).
 */
function mapVerifyError(
  err: unknown,
  values: { code?: string } | undefined,
): { ok: false; code: string; message: string; values?: { code?: string } } {
  if (err instanceof ApiError) {
    return {
      ok: false,
      code: err.errorCode ?? `HTTP_${err.statusCode}`,
      message: messageForCode(err.errorCode, err.statusCode),
      values,
    };
  }
  return {
    ok: false,
    code: 'NETWORK',
    message: 'Сеть недоступна. Попробуйте позже.',
    values,
  };
}

/** `details` is `{field: [English messages]}` — only the keys are trusted. */
function mapValidationDetails(
  details: unknown,
): Record<string, string> | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const fieldErrors: Record<string, string> = {};
  for (const field of Object.keys(details)) {
    if (field in FIELD_TEXTS_RU) {
      fieldErrors[field] = FIELD_TEXTS_RU[field as keyof typeof FIELD_TEXTS_RU];
    }
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

// messageForCode lives in lib/auth/errors.ts — a 'use server' module may only
// export async functions, and the anti-drift guard test needs the mapper.
