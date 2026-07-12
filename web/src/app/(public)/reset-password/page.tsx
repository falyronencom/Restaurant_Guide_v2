import type { Metadata } from 'next';
import Link from 'next/link';

import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

/*
 * /reset-password?token=… — the deep link from the reset email. RSC awaits
 * searchParams (Next 16 Promise shape, same as /login), guards the token
 * server-side and hands it to the island as a prop → hidden input → Server
 * Action. Token validity is the backend's verdict on submit; the page-level
 * guard only catches a missing/mangled link. noindex like /login.
 */

export const metadata: Metadata = {
  title: 'Новый пароль',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token =
    typeof params.token === 'string' && params.token.length > 0
      ? params.token
      : null;

  return (
    <main className="mx-auto w-full max-w-md px-l py-xl">
      <h1 className="font-display text-display-s text-foreground">
        Новый пароль
      </h1>
      {token ? (
        <div className="mt-l rounded-card bg-figma-bg-warm p-l">
          <ResetPasswordForm token={token} />
        </div>
      ) : (
        <>
          <p className="mt-s text-body-m text-figma-text-grey">
            Ссылка неполная или повреждена. Запросите новое письмо для сброса
            пароля.
          </p>
          <p className="mt-l text-body-m">
            <Link
              href="/forgot-password"
              className="font-medium text-brand transition-colors hover:text-brand-dark"
            >
              Запросить новую ссылку
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
