'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPasswordAction } from '@/lib/auth/actions';

/*
 * Reset-password form (mirrors LoginForm's useActionState wiring). The token
 * comes from the page's awaited `?token=` search param via a hidden input —
 * the same page-prop→hidden-input pattern LoginForm uses for returnTo. The
 * new password is NEVER echoed back on errors (React 19 clears it; the user
 * retypes). On success the backend revoked every session, so the island
 * offers the login link instead of auto-signing-in.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, null);

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-m">
        <p aria-live="polite" className="text-body-m text-foreground">
          {state.message}
        </p>
        <Link
          href="/login"
          className="font-medium text-brand transition-colors hover:text-brand-dark"
        >
          Войти
        </Link>
      </div>
    );
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const summaryError = state && !state.ok && !state.fieldErrors ? state.message : null;
  const tokenRejected = state && !state.ok && state.code === 'INVALID_OR_EXPIRED_TOKEN';

  return (
    <form action={formAction} className="flex flex-col gap-m" noValidate>
      <input type="hidden" name="token" value={token} />

      <div className="flex flex-col gap-s">
        <Label htmlFor="reset-password">Новый пароль</Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={fieldErrors?.password ? true : undefined}
          aria-describedby={
            fieldErrors?.password ? 'reset-password-error' : undefined
          }
        />
        {fieldErrors?.password ? (
          <p id="reset-password-error" className="text-caption-l text-destructive">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <p aria-live="polite" className="min-h-4 text-caption-l text-destructive">
        {summaryError}
      </p>

      {tokenRejected ? (
        <p className="text-body-m">
          <Link
            href="/forgot-password"
            className="font-medium text-brand transition-colors hover:text-brand-dark"
          >
            Запросить новую ссылку
          </Link>
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Сохраняем…' : 'Сохранить пароль'}
      </Button>
    </form>
  );
}
