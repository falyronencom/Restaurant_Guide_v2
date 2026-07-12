import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

/*
 * /forgot-password — request a password reset link by email. Static RSC
 * wrapper around a single island (no searchParams, no session dependency).
 * noindex: utility page, never a search target (same stance as /login).
 */

export const metadata: Metadata = {
  title: 'Восстановление пароля',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto w-full max-w-md px-l py-xl">
      <h1 className="font-display text-display-s text-foreground">
        Восстановление пароля
      </h1>
      <p className="mt-s text-body-m text-figma-text-grey">
        Укажите email, с которым вы регистрировались, — мы отправим на него
        ссылку для сброса пароля.
      </p>
      <div className="mt-l rounded-card bg-figma-bg-warm p-l">
        <ForgotPasswordForm />
      </div>
      <p className="mt-l text-body-m text-figma-text-grey">
        Вспомнили пароль?{' '}
        <Link
          href="/login"
          className="font-medium text-brand transition-colors hover:text-brand-dark"
        >
          Войти
        </Link>
      </p>
    </main>
  );
}
