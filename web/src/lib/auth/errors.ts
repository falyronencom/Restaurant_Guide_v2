/**
 * Russian messages for auth backend error codes (moved out of actions.ts in
 * the email-channel Slice 2: a 'use server' module may only export async
 * functions, and the B1-style anti-drift guard test needs direct access to
 * this mapper — mirrors lib/partner/errors.ts).
 *
 * Keys MUST match the codes the backend actually throws on the auth surface
 * (oauth / login / register / password-reset / email-verification). Manual
 * cross-target sync — a code the backend throws but this map omits degrades
 * SILENTLY to the neutral fallback (the drift class pinned by
 * auth-errors.test.ts).
 */

export function messageForCode(code: string | undefined, status: number): string {
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
    case 'EMAIL_EXISTS':
      return 'Аккаунт с таким email уже существует. Попробуйте войти.';
    case 'INVALID_CREDENTIALS':
      // Deliberately generic — mirrors the backend's anti-enumeration stance.
      return 'Неверный email или пароль.';
    case 'INVALID_OR_EXPIRED_TOKEN':
      return 'Ссылка для сброса пароля недействительна или устарела. Запросите новую.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'Слишком много попыток. Попробуйте позже.';
    // --- Email verification (Slice 2). Wire contract: DISCOVERY_slice2 §2. ---
    case 'INVALID_CODE':
      // 401 from verify: wrong code, attempts++ server-side.
      return 'Неверный код. Проверьте код из письма и попробуйте ещё раз.';
    case 'INVALID_OR_EXPIRED_CODE':
      // 410. ALSO the code the user hits after exhausting attempts: the 5th
      // wrong try marks the code used, so the 6th call is 410 — NOT 429
      // (auth-email-verification.test.js). Hence "запросите новый", not
      // "слишком много попыток".
      return 'Код неверный или истёк — запросите новый.';
    case 'TOO_MANY_ATTEMPTS':
      // 429 from verify (defensive, near-unreachable — see 410 note above).
      return 'Слишком много неверных попыток. Запросите новый код.';
    case 'RATE_LIMITED':
      // 429 from send: service-side per-user throttle (5 sends/hour).
      return 'Слишком много запросов кода. Попробуйте позже.';
    case 'NO_EMAIL':
      return 'У аккаунта не указан email.';
    case 'EMAIL_ALREADY_VERIFIED':
      // 409 — a graceful terminal state, not an error, on the verify screen.
      return 'Почта уже подтверждена.';
    case 'INVALID_REQUEST':
      // 400 inline shape check on verify (never a 422 on this route).
      return 'Введите 6-значный код из письма.';
    case 'NO_SESSION':
      // authedFetch: no recoverable session behind the cookies.
      return 'Войдите, чтобы подтвердить почту.';
    default:
      if (status === 429) return 'Слишком много попыток входа. Попробуйте позже.';
      // Neutral: this default also surfaces on the register form (e.g. 500),
      // so it must not say «войти».
      return 'Не удалось выполнить запрос. Попробуйте позже.';
  }
}
