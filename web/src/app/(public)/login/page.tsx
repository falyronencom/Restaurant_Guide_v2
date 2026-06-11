import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthRedirect } from '@/components/auth/AuthRedirect';
import { LoginForm } from '@/components/auth/LoginForm';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { guardReturnTo } from '@/lib/auth/yandex';

/*
 * /login — all three sign-in methods (email form + Google + Yandex), Slice 2.
 * RSC wrapper: guards returnTo server-side and hands the safe value to every
 * island; forms re-guard inside the action (form data is client-controlled).
 * noindex: utility page, never a search target. Forward-compat: this page is
 * the future Phase C partner-guard target, so returnTo must keep working.
 */

export const metadata: Metadata = {
  title: 'Вход',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const raw = typeof params.returnTo === 'string' ? params.returnTo : undefined;
  const returnTo = guardReturnTo(raw);
  const registerHref =
    returnTo === '/'
      ? '/register'
      : `/register?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="mx-auto w-full max-w-md px-l py-xl">
      <AuthRedirect returnTo={returnTo} />
      <h1 className="font-display text-headline-m text-foreground">Вход</h1>
      <div className="mt-l">
        <LoginForm returnTo={returnTo} />
      </div>
      <div className="mt-l border-t border-border pt-l">
        <OAuthButtons returnTo={returnTo} />
      </div>
      <p className="mt-l text-body-m text-figma-text-grey">
        Нет аккаунта?{' '}
        <Link
          href={registerHref}
          className="font-medium text-brand transition-colors hover:text-brand-dark"
        >
          Зарегистрироваться
        </Link>
      </p>
    </main>
  );
}
