import Link from 'next/link';
import { getMetadata } from '@/lib/api/endpoints/metadata';

/*
 * Root / — placeholder home page (Brief 2 foundation scope).
 *
 * Lists available city slugs as navigation entry points. No catalog or
 * marketing content yet — Brief 3 will build out the real home experience.
 */
export const revalidate = 3600;

export default async function HomePage() {
  const metadata = await getMetadata();

  return (
    <main className='flex flex-1 flex-col items-center justify-center p-l gap-l'>
      <h1 className='text-display-s font-display'>Nirivio</h1>
      <p className='text-body-m text-text-secondary'>
        Foundation placeholder — Brief 2 scaffolding.
      </p>
      <nav className='flex flex-wrap gap-s'>
        {metadata.cities.map((city) => (
          <Link
            key={city.slug}
            href={`/${city.slug}`}
            className='rounded-m bg-brand px-l py-s text-text-on-primary hover:bg-brand-dark transition-colors'
          >
            {city.name}
          </Link>
        ))}
      </nav>
    </main>
  );
}
