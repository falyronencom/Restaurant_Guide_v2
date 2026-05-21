import type { Metadata } from 'next';

/*
 * /[city]/[category]/[slug] — placeholder establishment detail.
 *
 * Brief 2 scope: echo params. Brief 3 will call getBySlug(slug) and render
 * the full detail composite (gallery, info card, menu, reviews carousel).
 *
 * generateStaticParams returns empty — same combinatorial argument as
 * the category route. Detail pages are good ISR candidates (long TTL,
 * stable URLs post-status='active'); Brief 3 may pre-warm popular slugs.
 */

export const revalidate = 3600;

type Params = { city: string; category: string; slug: string };

export async function generateStaticParams(): Promise<Params[]> {
  // Defer to runtime — pre-warming popular slugs deferred to Brief 3+.
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { city, slug } = await params;
  return {
    title: `${slug} — ${city}`,
    description: `Описание заведения ${slug} в городе ${city}`,
  };
}

export default async function EstablishmentPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { city, category, slug } = await params;

  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-l p-l'>
      <header className='flex flex-col gap-s'>
        <p className='text-caption-l text-muted-foreground'>
          {city} / {category} / {slug}
        </p>
        <h1 className='text-display-s font-display'>{slug}</h1>
        <p className='text-body-m text-muted-foreground'>
          Foundation placeholder — Brief 2 scaffold. Detail composite arrives in Brief 3.
        </p>
      </header>
    </main>
  );
}
