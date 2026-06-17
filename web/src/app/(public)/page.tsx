import { CitySelector } from '@/components/home/CitySelector';
import { Hero } from '@/components/home/Hero';
import { getMetadata } from '@/lib/api/endpoints/metadata';

/*
 * Home / — hero + city selector. Server Component reading no cookies/headers,
 * so the route stays statically rendered with ISR (revalidate below). The
 * header's transparent overlay variant is client-side (SiteHeader), which keeps
 * this page static.
 */
export const revalidate = 3600;

export default async function HomePage() {
  const { cities } = await getMetadata();

  return (
    <main className="flex flex-1 flex-col">
      <Hero cities={cities} />
      <CitySelector cities={cities} />
    </main>
  );
}
