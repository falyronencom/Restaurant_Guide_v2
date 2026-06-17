'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthMenu } from '@/components/auth/AuthMenu';
import type { MetadataSlug } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import { CitySwitcher } from './CitySwitcher';

type Props = {
  cities: MetadataSlug[];
};

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
 * Client Component: the variant depends on usePathname + a scroll listener,
 * both client-only. It reads NO cookies/headers, so the (public) layout stays a
 * Server Component and the public subtree keeps its ISR posture. The other
 * interactive parts (CitySwitcher, AuthMenu) are already client islands; cities
 * arrive as a serializable prop from the server layout.
 */
export function SiteHeader({ cities }: Props) {
  const pathname = usePathname();
  const isHome = pathname === '/';
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isHome) return undefined;
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    // Initial sync (e.g. a back-nav that restores scroll position); deferred a
    // tick to avoid a synchronous setState in the effect body.
    const timer = setTimeout(onScroll, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [isHome]);

  const overlay = isHome && !scrolled;

  return (
    <header
      className={cn(
        'sticky top-0 z-50 border-b transition-colors',
        overlay
          ? 'border-transparent bg-transparent'
          : 'border-border bg-background',
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-l px-l py-m">
        <Link
          href="/"
          aria-label="Nirivio — на главную"
          aria-hidden={overlay || undefined}
          tabIndex={overlay ? -1 : undefined}
          className={cn(
            'font-wordmark text-headline-l font-bold tracking-tight transition-opacity',
            overlay ? 'pointer-events-none opacity-0' : 'text-foreground',
          )}
        >
          NIRIVIO
        </Link>

        <div className="flex items-center gap-m">
          <CitySwitcher
            cities={cities}
            className={cn(
              'rounded-[8px] border px-s py-1 text-body-m transition-colors',
              overlay
                ? 'border-white/70 bg-transparent text-white'
                : 'border-border bg-background text-foreground',
            )}
          />
          <AuthMenu overlay={overlay} />
        </div>
      </div>
    </header>
  );
}
