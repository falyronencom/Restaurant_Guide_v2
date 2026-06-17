import { Hero } from '@/components/home/Hero';
import { getMetadata } from '@/lib/api/endpoints/metadata';

/*
 * Home / — hero (with search + filters). Server Component reading no
 * cookies/headers, so the route stays statically rendered with ISR (revalidate
 * below). The header's transparent overlay variant is client-side (SiteHeader),
 * which keeps this page static. The body below the hero (popular per-city +
 * category tiles + partner CTA) is Segment D.
 */
export const revalidate = 3600;

export default async function HomePage() {
  const { cities, cuisines } = await getMetadata();

  return (
    <main className="flex flex-1 flex-col">
      <Hero cities={cities} cuisines={cuisines} />
    </main>
  );
}
