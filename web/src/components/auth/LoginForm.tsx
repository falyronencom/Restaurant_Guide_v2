'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginAction } from '@/lib/auth/actions';

import { useAuth } from './AuthProvider';

/*
 * Email/password login form (Slice 2). useActionState per the installed Next
 * forms guide: state carries per-field Russian errors from the action, pending
 * disables the submit. On success the action has already set the httpOnly
 * cookies; we only sync the client context — AuthRedirect (rendered by the
 * page) picks up the status change and navigates to returnTo.
 */
export function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const { applySession } = useAuth();

  useEffect(() => {
    if (state?.ok) {
      applySession(state.user);
    }
  }, [state, applySession]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const summaryError = state && !state.ok && !state.fieldErrors ? state.message : null;
  // React 19 resets uncontrolled inputs after a form action; the echoed email
  // repopulates via defaultValue (password is never echoed).
  const values = state && !state.ok ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-m" noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-col gap-s">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={values?.email}
          aria-invalid={fieldErrors?.email ? true : undefined}
          aria-describedby={fieldErrors?.email ? 'login-email-error' : undefined}
        />
        {fieldErrors?.email ? (
          <p id="login-email-error" className="text-caption-l text-destructive">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-s">
        <Label htmlFor="login-password">Пароль</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={fieldErrors?.password ? true : undefined}
          aria-describedby={
            fieldErrors?.password ? 'login-password-error' : undefined
          }
        />
        {fieldErrors?.password ? (
          <p id="login-password-error" className="text-caption-l text-destructive">
            {fieldErrors.password}
          </p>
        ) : null}
        <Link
          href="/forgot-password"
          className="self-start text-caption-l font-medium text-brand transition-colors hover:text-brand-dark"
        >
          Забыли пароль?
        </Link>
      </div>

      <p aria-live="polite" className="min-h-4 text-caption-l text-destructive">
        {summaryError}
      </p>

      <Button type="submit" size="cta" className="w-full" disabled={pending}>
        {pending ? 'Входим…' : 'Войти'}
      </Button>
    </form>
  );
}
