/*
 * /proto-hero — DISPOSABLE visual target for Segment C (home hero). NOT prod.
 *
 * Built on Segment A bricks: synced hero photo (/search_background.jpg) +
 * `font-wordmark` (Josefin) + real tokens. Shows the hero COMPOSITION that the
 * Segment C Implementar should produce. The transparent/overlay header is
 * Segment C's own job (hook in SiteHeader className) — this route is standalone
 * (outside the (public) shell) to focus on the hero band. Delete after use.
 */
export const revalidate = 3600;

export default function ProtoHeroPage() {
  return (
    <main className="relative min-h-[88vh] w-full overflow-hidden">
      {/* Synced own-photo hero (Segment A asset bridge) */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/search_background.jpg')" }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-black/65" aria-hidden="true" />
      <div
        className="absolute inset-x-0 bottom-0 h-48"
        style={{
          background:
            'linear-gradient(to top, rgba(200,113,75,0.20), transparent)',
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-3xl flex-col items-center justify-center px-l text-center">
        {/* Wordmark — font-wordmark (Josefin, latin), letter-spaced */}
        <h1 className="font-wordmark text-[60px] leading-none font-semibold tracking-[0.3em] text-white sm:text-[80px] md:text-[96px]">
          NIRIVIO
        </h1>
        {/* Slogan — Cyrillic → Unbounded (font-display), per Segment A */}
        <p className="mt-l font-display text-[18px] font-light tracking-[0.3em] text-white/85 md:text-[22px]">
          Вкусное рядом
        </p>

        {/* City + Filters pills — mobile-faithful (_buildCityFilterRow) */}
        <div className="mt-xl flex items-center gap-m">
          <span className="flex items-center gap-s rounded-full border border-white/70 px-l py-s text-label-l text-white">
            Минск
            <span aria-hidden="true" className="text-white/70">▾</span>
          </span>
          <span className="flex items-center gap-s rounded-full border border-white/70 px-l py-s text-label-l text-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
              <circle cx="15" cy="7" r="2" />
              <circle cx="9" cy="17" r="2" />
            </svg>
            Фильтры
          </span>
        </div>

        {/* Search bar — orange button = primary search (Booking «Найти») */}
        <div className="mt-m flex w-full max-w-[34rem] items-stretch overflow-hidden rounded-full bg-white shadow-xl">
          <span className="flex flex-1 items-center px-l py-m text-left text-body-l text-text-tertiary">
            Найти заведение в Минске
          </span>
          <span className="flex items-center justify-center bg-brand px-l text-2xl text-white">
            ›
          </span>
        </div>
      </div>
    </main>
  );
}
