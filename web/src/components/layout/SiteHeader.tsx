import Link from 'next/link';

import { AuthMenu } from '@/components/auth/AuthMenu';
import type { MetadataSlug } from '@/lib/api/types';

import { CitySwitcher } from './CitySwitcher';

type Props = {
  cities: MetadataSlug[];
};

/*
 * Unified site header — one chrome for the home, city and catalog routes (and,
 * as the accepted D-A side-effect, /login + /register, which also sit under the
 * (public) group). Greenfield replacement for the Brief-2 minimal header.
 *
 * This is a Server Component; the only interactive parts are the CitySwitcher
 * and AuthMenu client islands, so the (public) layout stays cookie-free and the
 * public subtree keeps its ISR posture.
 *
 * Variant: this ships the SOLID, sticky variant used on every inner page. The
 * transparent/overlay-on-hero variant (light text + gradient, turning solid on
 * scroll, with the hero pulled up under it) is introduced in Segment C when the
 * home hero lands — it hooks into the header className here.
 */
export function SiteHeader({ cities }: Props) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-l px-l py-m">
        <Link
          href="/"
          aria-label="Nirivio — на главную"
          className="font-wordmark text-headline-l font-bold tracking-tight text-foreground"
        >
          NIRIVIO
        </Link>

        <div className="flex items-center gap-m">
          <CitySwitcher
            cities={cities}
            className="rounded-[8px] border border-border bg-background px-s py-1 text-body-m text-foreground"
          />
          <AuthMenu />
        </div>
      </div>
    </header>
  );
}
