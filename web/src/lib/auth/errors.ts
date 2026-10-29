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
 *
 * The words are the backend's own (backend/src/constants/authRefusals.js —
 * one dictionary of sign-in refusals for the server, the app and the site,
 * Coordinator 25.10 and 29.10.2026); auth-refusals-guard.test.ts reads that
 * file and holds every shared case equal. The site keeps its own texts by
 * code rather than printing the backend's: a code travels in the URL
 * (oauth-error.ts), a text never does.
 */

import { SUPPORT_EMAIL } from '@/lib/account/deletion';

export function messageForCode(code: string | undefined, status: number): string {
  switch (code) {
    case 'INVALID_TOKEN':
      // Google only: a failed Yandex sign-in has its own line (oauth-error.ts).
      return 'Не удалось войти через Google. Попробуйте ещё раз или войдите другим способом.';
    case 'OAUTH_NO_EMAIL':
      return 'Сервис входа не передал адрес почты. Войдите другим способом.';
    case 'OAUTH_EMAIL_NOT_VERIFIED':
      return 'Почта в этом сервисе не подтверждена. Подтвердите её там или войдите другим способом.';
    case 'ACCOUNT_DEACTIVATED':
      return `Учётная запись отключена. Если это ошибка — напишите в поддержку: ${SUPPORT_EMAIL}`;
    case 'ACCOUNT_CONFLICT':
      // Two first sign-ins with one address collided — a retry goes through.
      return 'Не удалось завершить вход. Попробуйте ещё раз.';
    case 'EMAIL_EXISTS':
      return 'Этот email уже зарегистрирован. Попробуйте войти.';
    case 'INVALID_CREDENTIALS':
      // Deliberately generic — mirrors the backend's anti-enumeration stance.
      // The site signs in by email only, so the backend's «email/телефон»
      // narrows to «email» here — the one sanctioned difference.
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
      return 'Код истёк или недействителен. Запросите новый.';
    case 'TOO_MANY_ATTEMPTS':
      // 429 from verify (defensive, near-unreachable — see 410 note above).
      return 'Слишком много неверных попыток. Запросите новый код.';
    case 'RATE_LIMITED':
      // 429 from send: service-side per-user throttle (5 sends/hour).
      return 'Слишком много запросов кода. Попробуйте позже.';
    case 'NO_EMAIL':
      return 'В учётной записи не указана почта.';
    case 'EMAIL_ALREADY_VERIFIED':
      // 409 — a graceful terminal state, not an error, on the verify screen.
      return 'Почта уже подтверждена.';
    case 'INVALID_REQUEST':
      // 400 inline shape check on verify (never a 422 on this route).
      return 'Введите 6-значный код из письма.';
    case 'NO_SESSION':
      // authedFetch: no recoverable session behind the cookies.
      return 'Войдите, чтобы подтвердить почту.';
    case 'SESSION_REFRESH_UNAVAILABLE':
      // authedFetch: the session refresh got no answer — the session itself
      // may be alive, so no «войдите» here.
      return 'Сервер временно недоступен. Попробуйте ещё раз.';
    default:
      if (status === 429) return 'Слишком много попыток входа. Попробуйте позже.';
      // Neutral: this default also surfaces on the register form (e.g. 500),
      // so it must not say «войти».
      return 'Не удалось выполнить запрос. Попробуйте позже.';
  }
}
