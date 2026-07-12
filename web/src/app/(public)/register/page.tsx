import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthRedirect } from '@/components/auth/AuthRedirect';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { guardReturnTo } from '@/lib/auth/yandex';

/*
 * /register — email/password registration + both OAuth providers (Slice 2).
 * Mirror of /login; see that page for the returnTo / noindex rationale.
 * Web registration is email-only — phone signup stays mobile-territory.
 */

export const metadata: Metadata = {
  title: 'Регистрация',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const raw = typeof params.returnTo === 'string' ? params.returnTo : undefined;
  const returnTo = guardReturnTo(raw);
  const loginHref =
    returnTo === '/'
      ? '/login'
      : `/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="mx-auto w-full max-w-md px-l py-xl">
      <AuthRedirect returnTo={returnTo} />
      <h1 className="font-display text-display-s text-foreground">
        Регистрация
      </h1>
      <div className="mt-l rounded-card bg-figma-bg-warm p-l">
        <RegisterForm returnTo={returnTo} />
        <div className="mt-l border-t border-figma-divider pt-l">
          <OAuthButtons returnTo={returnTo} />
        </div>
      </div>
      <p className="mt-l text-body-m text-figma-text-grey">
        Уже есть аккаунт?{' '}
        <Link
          href={loginHref}
          className="font-medium text-brand transition-colors hover:text-brand-dark"
        >
          Войти
        </Link>
      </p>
    </main>
  );
}
