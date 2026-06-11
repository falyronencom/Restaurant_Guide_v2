'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from './AuthProvider';

/*
 * Client guard for /login and /register: as soon as the context reports an
 * authenticated session — mount-hydrate for an already-logged-in visitor, or
 * applySession right after an email-form / Google success — replace to the
 * guarded returnTo. This centralises post-login navigation for every method
 * on these pages (the Yandex flow navigates via its callback Route Handler
 * instead and never comes back here). Plain replace, no router.refresh():
 * public RSC pages are auth-agnostic; personalization hydrates client-side.
 */
export function AuthRedirect({ returnTo }: { returnTo: string }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(returnTo);
    }
  }, [status, returnTo, router]);

  return null;
}
