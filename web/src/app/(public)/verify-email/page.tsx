import type { Metadata } from 'next';

import { VerifyEmailForm } from '@/components/auth/VerifyEmailForm';

/*
 * /verify-email — enter the 6-digit email verification code (email-channel
 * Slice 2). Reachable via the post-register hard navigation and by direct
 * link. A static RSC wrapper: deliberately NO cookies() here (that would force
 * dynamic rendering) — auth-awareness lives client-side in the island, real
 * enforcement is authedFetch throwing NO_SESSION inside the Server Actions.
 * noindex like the other auth utility pages.
 */

export const metadata: Metadata = {
  title: 'Подтверждение почты',
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <main className="mx-auto w-full max-w-md px-l py-xl">
      <h1 className="font-display text-headline-m text-foreground">
        Подтверждение почты
      </h1>
      <div className="mt-l">
        <VerifyEmailForm />
      </div>
    </main>
  );
}
