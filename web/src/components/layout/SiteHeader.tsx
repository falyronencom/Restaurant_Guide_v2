'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthMenu } from '@/components/auth/AuthMenu';
import { cn } from '@/lib/utils';

import { MobileNav } from './MobileNav';

/*
 * Unified site header — one chrome for the home, city and catalog routes (and,
 * as the accepted D-A side-effect, /login + /register, which also sit under the
 * (public) group).
 *
 * Two variants:
 *  - SOLID (default): every inner page — opaque background, dark text, sticky.
 *  - OVERLAY (home only, before scroll): transparent over the hero with light
 *    text; the wordmark is hidden because the hero carries the large wordmark.
 *    It turns solid once the user scrolls past a small threshold.
 *
 * Controls: «Стать партнёром» (the vitrine's partner-acquisition CTA → the
 * cabinet create flow; logged-out users pass through /login) + the account
 * control (AuthMenu: a dropdown when signed in, «Войти» when not). City
 * switching lives in the home hero chip and the footer, not the header
 * (Coordinator review 2026-06-17 — removes a redundant city picker and makes the
 * header partner-forward).
 *
 * Responsive: from `md` up the controls sit inline; below `md` they collapse
 * into a single burger → sheet drawer (MobileNav), so the bar never wraps. The
 * inner row is a fixed 72px (73px with the 1px border-b) — the home/catalog hero
 * pulls itself up under the header by exactly that (-mt-[73px]), so the height
 * must not vary with content.
 *
 * Client Component: the variant depends on usePathname + a scroll listener,
 * both client-only. It reads NO cookies/headers, so the (public) layout stays a
 * Server Component and the public subtree keeps its ISR posture. AuthMenu is the
 * other client island.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const isHome = pathname === '/';
  // Routes with a photo banner the header overlays: home, the city page
  // (/{city}) and the catalog (/{city}/{category}). Auth pages (/login,
  // /register) are also 1-segment but have NO banner — exclude them. The detail
  // page (3 segments) and reviews (4) keep the solid header.
  const segments = pathname.split('/').filter(Boolean);
  const isCity =
    segments.length === 1 && !['login', 'register'].includes(segments[0]);
  const isCatalog = segments.length === 2;
  const hasOverlayHero = isHome || isCity || isCatalog;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!hasOverlayHero) return undefined;
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    // Initial sync (e.g. a back-nav that restores scroll position); deferred a
    // tick to avoid a synchronous setState in the effect body.
    const timer = setTimeout(onScroll, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [hasOverlayHero]);

  const overlay = hasOverlayHero && !scrolled;
  // The home hero carries its own large wordmark, so the header wordmark is
  // hidden while overlaying there; the catalog banner has none, so it stays
  // visible (white over the photo).
  const hideWordmark = overlay && isHome;

  return (
    <header
      className={cn(
        'sticky top-0 z-50 border-b transition-colors',
        overlay
          ? 'border-transparent bg-transparent'
          : 'border-border bg-background',
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-l px-l">
        <Link
          href="/"
          aria-label="Nirivio — на главную"
          aria-hidden={hideWordmark || undefined}
          tabIndex={hideWordmark ? -1 : undefined}
          className={cn(
            'font-wordmark text-headline-l font-bold tracking-tight transition-opacity',
            hideWordmark
              ? 'pointer-events-none opacity-0'
              : overlay
                ? 'text-white'
                : 'text-foreground',
          )}
        >
          NIRIVIO
        </Link>

        {/* Desktop — partner CTA + account control inline (md and up). */}
        <div className="hidden items-center gap-m text-body-m md:flex">
          <Link
            href="/login?returnTo=/cabinet/new"
            className={cn(
              'rounded-[10px] border px-m py-2 font-medium transition-colors',
              overlay
                ? 'border-white/70 text-white hover:bg-white/10'
                : 'border-border text-foreground hover:bg-muted',
            )}
          >
            Стать партнёром
          </Link>
          <AuthMenu overlay={overlay} />
        </div>

        {/* Mobile — everything collapses into a burger → sheet drawer. */}
        <div className="flex md:hidden">
          <MobileNav overlay={overlay} />
        </div>
      </div>
    </header>
  );
}
