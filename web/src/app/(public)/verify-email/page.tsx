import type { Metadata } from 'next';

import { VerifyEmailForm } from '@/components/auth/VerifyEmailForm';
import { guardReturnTo } from '@/lib/auth/yandex';

/*
 * /verify-email — enter the 6-digit email verification code (email-channel
 * Slice 2). Reachable via the post-register hard navigation and by direct
 * link. No cookies() here — auth-awareness lives client-side in the island,
 * real enforcement is authedFetch throwing NO_SESSION inside the Server
 * Actions. It reads ?returnTo= (like /login — the page renders per request):
 * the place the visitor registered from, where «Продолжить» and «Позже» lead.
 * noindex like the other auth utility pages.
 */

export const metadata: Metadata = {
  title: 'Подтверждение почты',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const returnTo = guardReturnTo(
    typeof params.returnTo === 'string' ? params.returnTo : undefined,
  );

  return (
    <main className="mx-auto w-full max-w-md px-l py-xl">
      <h1 className="font-display text-display-s text-foreground">
        Подтверждение почты
      </h1>
      <div className="mt-l rounded-card bg-figma-bg-warm p-l">
        <VerifyEmailForm returnTo={returnTo} />
      </div>
    </main>
  );
}
