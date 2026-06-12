import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth/session';

/*
 * Partner cabinet layout + guard (Phase C Slice 1, Segment B — Decision 6).
 *
 * The guard is a server-side cookie check in the layout (NOT middleware — none
 * exists; the slice deliberately introduces this layout pattern instead). Any
 * authenticated session may enter: a partner is born on the first establishment
 * create, so role is not checked here. No session → redirect to /login.
 *
 * Reading the session cookie forces dynamic rendering for the whole cabinet
 * subtree, which is acceptable here (Decision 6) — the public catalog's ISR
 * posture is untouched (it never imports this server-only session module). The
 * cabinet is noindex (metadata robots) — it must never reach search engines.
 *
 * Header entry into the cabinet is intentionally OUT of slice (Слайс 2 / redesign
 * collision) — access is by URL. This layout provides the cabinet's own chrome.
 */

export const metadata: Metadata = {
  title: 'Кабинет партнёра',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CabinetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login?returnTo=/cabinet');
  }

  return (
    <div className="flex min-h-full flex-col bg-figma-bg-warm">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-l py-m">
          <Link
            href="/cabinet"
            className="font-display text-headline-m text-foreground"
          >
            Nirivio · Кабинет
          </Link>
          <Link
            href="/"
            className="text-body-s text-figma-text-grey transition-colors hover:text-foreground"
          >
            На сайт
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-l py-l">
        {children}
      </main>
    </div>
  );
}
