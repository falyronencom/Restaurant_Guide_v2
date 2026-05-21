import type { Metadata } from 'next';

/*
 * /[city]/[category] — placeholder category overview.
 *
 * Brief 2 scope: render the city/category combination as text. Brief 3 will
 * fetch catalog list via getCatalog({ city, category }) and render
 * EstablishmentCard composites.
 *
 * generateStaticParams returns empty by design — combinations are too many
 * (cities × 15 categories) to prerender all; ISR-on-demand handles new
 * combinations at first request, then caches per `revalidate` window.
 */

export const revalidate = 3600;

type Params = { city: string; category: string };

export async function generateStaticParams(): Promise<Params[]> {
  // Defer to runtime — combinations explosion. Brief 3 may revisit.
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { city, category } = await params;
  return {
    title: `${category} — ${city}`,
    description: `${category} в городе ${city}`,
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { city, category } = await params;

  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-l p-l'>
      <header className='flex flex-col gap-s'>
        <p className='text-caption-l text-muted-foreground'>
          {city} / {category}
        </p>
        <h1 className='text-display-s font-display capitalize'>{category}</h1>
        <p className='text-body-m text-muted-foreground'>
          Foundation placeholder — Brief 2 scaffold. Listing renders in Brief 3.
        </p>
      </header>
    </main>
  );
}
