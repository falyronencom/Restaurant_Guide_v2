import type { Metadata } from 'next';
import Link from 'next/link';

/*
 * User account route group (user-ЛК Slice 1) — structural clone of the cabinet
 * chrome (header container + max-w-5xl main) WITHOUT the cabinet's server
 * cookie guard: this subtree reads NO cookies() anywhere, so the pages stay
 * static shells (ISR hygiene); auth is client-side in the islands (NO_SESSION
 * from the buffered Route Handler → redirect to /login?returnTo=…).
 *
 * Deliberate deviation from the cabinet clone: the page background stays
 * bg-background (not bg-figma-bg-warm) — /favorites reuses the catalog
 * EstablishmentCard, whose warm-beige content column needs the catalog's light
 * page background for contrast, and the profile's warm card needs the same.
 * Card canon wins over a literal class copy.
 *
 * noindex: utility account pages must never reach search engines (metadata
 * robots inherited by both children).
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const navLinkClass =
    'text-body-s text-figma-text-grey transition-colors hover:text-foreground';
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-l py-m">
          <Link
            href="/"
            className="font-display text-headline-m text-foreground"
          >
            Nirivio
          </Link>
          <nav className="flex items-center gap-l">
            <Link href="/favorites" className={navLinkClass}>
              Избранное
            </Link>
            <Link href="/profile" className={navLinkClass}>
              Профиль
            </Link>
            <Link href="/" className={navLinkClass}>
              На сайт
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-l py-l">
        {children}
      </main>
    </div>
  );
}
