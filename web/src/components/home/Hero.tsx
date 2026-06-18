import Image from 'next/image';

import type { MetadataSlug } from '@/lib/api/types';

import { HeroSearch } from './HeroSearch';

type Props = {
  cities: MetadataSlug[];
  categories: MetadataSlug[];
  cuisines: MetadataSlug[];
};

/*
 * Home hero — full-bleed own-photo band with the NIRIVIO wordmark, slogan and
 * the search cluster. Composition mirrors the ratified /proto-hero target.
 *
 * Overlay coupling: the (public) SiteHeader is `sticky top-0` and occupies its
 * height in normal flow, so the hero is pulled up beneath it (negative top
 * margin) to sit directly under the transparent overlay header — otherwise a
 * blank strip would show above the photo. The header turns solid on scroll
 * (client logic in SiteHeader); this pull-up applies only on the home route,
 * since the hero is rendered only here. The -mt value matches the live header
 * height (verified via preview_inspect).
 *
 * LCP: the background photo is `priority` (preloaded); the large heading rides
 * on the already-loaded Unbounded (font-display) and the wordmark on Josefin
 * (font-wordmark, latin-only — never Cyrillic). The slogan stays on Unbounded.
 */
export function Hero({ cities, categories, cuisines }: Props) {
  return (
    <section className="relative -mt-[72px] min-h-[80vh] w-full overflow-hidden">
      <Image
        src="/search_background.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
      <div
        className="absolute inset-x-0 bottom-0 h-48"
        style={{
          background:
            'linear-gradient(to top, rgba(200,113,75,0.20), transparent)',
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[80vh] max-w-3xl flex-col items-center justify-center px-l text-center">
        {/* Wordmark — Josefin (latin), letter-spaced */}
        <h1 className="font-wordmark text-[60px] leading-none font-semibold tracking-[0.3em] text-white sm:text-[80px] md:text-[96px]">
          NIRIVIO
        </h1>
        {/* Slogan — Cyrillic → Unbounded (font-display) */}
        <p className="mt-l font-display text-[18px] font-light tracking-[0.2em] text-white/85 md:text-[22px]">
          Вкусное рядом
        </p>

        <HeroSearch cities={cities} categories={categories} cuisines={cuisines} />
      </div>
    </section>
  );
}
