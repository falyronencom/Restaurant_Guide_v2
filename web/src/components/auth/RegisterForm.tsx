'use client';

import { useActionState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerAction } from '@/lib/auth/actions';

import { useAuth } from './AuthProvider';

const PASSWORD_HINT = 'Минимум 8 символов, заглавная и строчная буквы, цифра.';

/*
 * Email/password registration form (Slice 2). Same mechanics as LoginForm:
 * useActionState + per-field errors from the action, AuthRedirect navigates
 * after applySession. The password requirements hint is always visible (grey)
 * and is replaced by the destructive per-field text when the rule fails.
 */
export function RegisterForm({ returnTo }: { returnTo: string }) {
  const [state, formAction, pending] = useActionState(registerAction, null);
  const { applySession } = useAuth();

  useEffect(() => {
    if (state?.ok) {
      applySession(state.user);
    }
  }, [state, applySession]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const summaryError = state && !state.ok && !state.fieldErrors ? state.message : null;
  // React 19 resets uncontrolled inputs after a form action; on the error
  // re-render they re-read defaultValue, so the echoed values keep the form
  // populated. The password is never echoed — the user re-enters it.
  const values = state && !state.ok ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-m" noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-col gap-s">
        <Label htmlFor="register-name">Имя</Label>
        <Input
          id="register-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
          defaultValue={values?.name}
          aria-invalid={fieldErrors?.name ? true : undefined}
          aria-describedby={fieldErrors?.name ? 'register-name-error' : undefined}
        />
        {fieldErrors?.name ? (
          <p id="register-name-error" className="text-caption-l text-destructive">
            {fieldErrors.name}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-s">
        <Label htmlFor="register-email">Email</Label>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={values?.email}
          aria-invalid={fieldErrors?.email ? true : undefined}
          aria-describedby={
            fieldErrors?.email ? 'register-email-error' : undefined
          }
        />
        {fieldErrors?.email ? (
          <p id="register-email-error" className="text-caption-l text-destructive">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-s">
        <Label htmlFor="register-password">Пароль</Label>
        <Input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={fieldErrors?.password ? true : undefined}
          aria-describedby="register-password-hint"
        />
        <p
          id="register-password-hint"
          className={
            fieldErrors?.password
              ? 'text-caption-l text-destructive'
              : 'text-caption-l text-muted-foreground'
          }
        >
          {fieldErrors?.password ?? PASSWORD_HINT}
        </p>
      </div>

      <p aria-live="polite" className="min-h-4 text-caption-l text-destructive">
        {summaryError}
      </p>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
      </Button>
    </form>
  );
}
