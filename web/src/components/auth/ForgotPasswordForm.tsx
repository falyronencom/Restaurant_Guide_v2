'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPasswordAction } from '@/lib/auth/actions';

/*
 * Forgot-password form (mirrors LoginForm's useActionState wiring). On success
 * the form is replaced by the fixed generic confirmation — the SAME text
 * whether or not the email exists (enumeration safety lives in the backend
 * contract; the UI must not undermine it with different outcomes either).
 */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, null);

  if (state?.ok) {
    return (
      <p aria-live="polite" className="text-body-m text-foreground">
        {state.message}
      </p>
    );
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const summaryError = state && !state.ok && !state.fieldErrors ? state.message : null;
  // React 19 resets uncontrolled inputs after a form action; the echoed email
  // repopulates via defaultValue.
  const values = state && !state.ok ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-m" noValidate>
      <div className="flex flex-col gap-s">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={values?.email}
          aria-invalid={fieldErrors?.email ? true : undefined}
          aria-describedby={fieldErrors?.email ? 'forgot-email-error' : undefined}
        />
        {fieldErrors?.email ? (
          <p id="forgot-email-error" className="text-caption-l text-destructive">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <p aria-live="polite" className="min-h-4 text-caption-l text-destructive">
        {summaryError}
      </p>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Отправляем…' : 'Отправить ссылку'}
      </Button>
    </form>
  );
}
