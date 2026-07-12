'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  resendVerificationCodeAction,
  verifyEmailCodeAction,
} from '@/lib/auth/actions';

import { useAuth } from './AuthProvider';

/*
 * Verify-email code form (email-channel Slice 2). Two independent forms — the
 * 6-digit code entry and the resend button — each with its own useActionState,
 * so their pending/error states never interfere. Auth-awareness is client-side
 * (useAuth); the real enforcement is authedFetch throwing NO_SESSION inside
 * the actions. Terminal states replace the form (ForgotPasswordForm pattern):
 * success («Почта подтверждена») and the graceful 409 EMAIL_ALREADY_VERIFIED
 * from EITHER action («Почта уже подтверждена») — the latter is an expected
 * outcome, not a destructive error.
 */
export function VerifyEmailForm() {
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyEmailCodeAction,
    null,
  );
  const [resendState, resendAction, resendPending] = useActionState(
    resendVerificationCodeAction,
    null,
  );
  const { status } = useAuth();

  // A logged-out visitor on the direct link: invite to login and come back.
  // While the context hydrates ('loading') the form renders optimistically —
  // the usual arrival is the post-register hard navigation with a live session.
  if (status === 'anonymous') {
    return (
      <div className="flex flex-col gap-m">
        <p className="text-body-m text-figma-text-grey">
          Войдите, чтобы подтвердить почту.
        </p>
        <p className="text-body-m">
          <Link
            href="/login?returnTo=%2Fverify-email"
            className="font-medium text-brand transition-colors hover:text-brand-dark"
          >
            Войти
          </Link>
        </p>
      </div>
    );
  }

  if (verifyState?.ok) {
    return (
      <div className="flex flex-col gap-m">
        <p aria-live="polite" className="text-body-m text-foreground">
          Почта подтверждена.
        </p>
        <Link
          href="/"
          className="font-medium text-brand transition-colors hover:text-brand-dark"
        >
          На главную
        </Link>
      </div>
    );
  }

  const alreadyVerified =
    (verifyState && !verifyState.ok && verifyState.code === 'EMAIL_ALREADY_VERIFIED') ||
    (resendState && !resendState.ok && resendState.code === 'EMAIL_ALREADY_VERIFIED');
  if (alreadyVerified) {
    return (
      <div className="flex flex-col gap-m">
        <p aria-live="polite" className="text-body-m text-foreground">
          Почта уже подтверждена.
        </p>
        <Link
          href="/"
          className="font-medium text-brand transition-colors hover:text-brand-dark"
        >
          На главную
        </Link>
      </div>
    );
  }

  const summaryError = verifyState && !verifyState.ok ? verifyState.message : null;
  // React 19 resets uncontrolled inputs after a form action; the echoed code
  // repopulates via defaultValue (low-sensitivity, unlike passwords).
  const values = verifyState && !verifyState.ok ? verifyState.values : undefined;
  const resendMessage = resendState ? resendState.message : null;
  const resendIsError = resendState ? !resendState.ok : false;

  return (
    <div className="flex flex-col gap-l">
      <form action={verifyAction} className="flex flex-col gap-m" noValidate>
        <div className="flex flex-col gap-s">
          <Label htmlFor="verify-code">Код из письма</Label>
          <Input
            id="verify-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            // No maxLength: it would truncate a paste with a leading space
            // (" 123456" → " 12345"); the action trims and shape-checks instead.
            autoComplete="one-time-code"
            required
            defaultValue={values?.code}
            aria-invalid={summaryError ? true : undefined}
            aria-describedby="verify-code-hint"
          />
          <p id="verify-code-hint" className="text-caption-l text-figma-text-dark">
            Мы отправили 6-значный код на вашу почту.
          </p>
        </div>

        <p aria-live="polite" className="min-h-4 text-caption-l text-destructive">
          {summaryError}
        </p>

        <Button type="submit" size="cta" className="w-full" disabled={verifyPending}>
          {verifyPending ? 'Проверяем…' : 'Подтвердить'}
        </Button>
      </form>

      <form action={resendAction} className="flex flex-col gap-s">
        <p
          aria-live="polite"
          className={
            resendIsError
              ? 'min-h-4 text-caption-l text-destructive'
              : 'min-h-4 text-caption-l text-foreground'
          }
        >
          {resendMessage}
        </p>
        <button
          type="submit"
          disabled={resendPending}
          className="self-start font-medium text-brand transition-colors hover:text-brand-dark disabled:opacity-50"
        >
          {resendPending ? 'Отправляем…' : 'Отправить код повторно'}
        </button>
      </form>
    </div>
  );
}
