import 'server-only';

import { authedFetch } from '@/lib/auth/session';

/*
 * Email verification — authenticated typed endpoint functions over
 * /api/v1/auth/{send-verification-code,verify-email-code}. Both are
 * Bearer-gated and act only on the caller's own account (user id derived from
 * the JWT — never sent in a payload). Wire contract: DISCOVERY_slice2 §2.
 */

/**
 * `sent:false` means the code row WAS created but the email could not be
 * dispatched (Resend unconfigured — the dev-mode reality). The UI deliberately
 * does not distinguish: the difference is infrastructure state, not something
 * the user can act on.
 */
export type SendVerificationCodeData = { sent: boolean; expiresAt: string };

export async function sendVerificationCode(): Promise<SendVerificationCodeData> {
  return authedFetch<SendVerificationCodeData>(
    '/api/v1/auth/send-verification-code',
    { method: 'POST' },
  );
}

/**
 * Success (200) carries the full user with `emailVerified:true` — deliberately
 * NOT consumed here (Decision V «screen only»: no session re-stamp). The
 * deferred session-wiring increment will read it from this response.
 */
export async function verifyEmailCode(code: string): Promise<void> {
  await authedFetch('/api/v1/auth/verify-email-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}
