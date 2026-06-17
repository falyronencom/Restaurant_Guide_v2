import { AppBanner } from '@/components/home/AppBanner';
import { CategoryTilesSection } from '@/components/home/CategoryTilesSection';
import { Hero } from '@/components/home/Hero';
import { PartnerCtaSection } from '@/components/home/PartnerCtaSection';
import { PopularSection } from '@/components/home/PopularSection';
import { getMetadata } from '@/lib/api/endpoints/metadata';

/*
 * Home / — hero + body sections. Server Component reading no cookies/headers, so
 * the route stays statically rendered with ISR (revalidate below). The header's
 * transparent overlay variant is client-side (SiteHeader), which keeps this page
 * static.
 *
 * Body (Segment D-2) — three audiences on one page:
 *   - PopularSection (users)   — top-rated, DEFAULT city (Минск) STATIC; reading
 *                                the selected city server-side would break ISR.
 *   - CategoryTilesSection     — browse into the SEO surfaces; selected city is
 *                                client-only (useSelectedCity), no server read.
 *   - PartnerCtaSection (partners) → /login?returnTo=/cabinet/new.
 *   - AppBanner                — Android sticky-bar (iOS uses the native Apple
 *                                banner from the root-layout `itunes` metadata).
 * Every server fetch here takes fixed args (no request-derived input), so `/`
 * stays ○ Static.
 */
export const revalidate = 3600;

export default async function HomePage() {
  const { cities, categories, cuisines } = await getMetadata();

  return (
    <main className="flex flex-1 flex-col">
      <Hero cities={cities} categories={categories} cuisines={cuisines} />
      <PopularSection />
      <CategoryTilesSection cities={cities} categories={categories} />
      <PartnerCtaSection />
      <AppBanner />
    </main>
  );
}
