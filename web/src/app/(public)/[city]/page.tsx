import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';

import { getMetadata, validateCitySlug } from '@/lib/api/endpoints/metadata';

/*
 * /[city] — placeholder city overview.
 *
 * Brief 2 scope: validate city slug → 404 on unknown; render category links
 * for the city. NO catalog rendering (Brief 3).
 *
 * NOTE on greedy [city] at root level: any URL like /about, /contact, etc.
 * tries to match [city] first. Catalog 404 protects against most cases, but
 * future static top-level pages must be declared BEFORE introducing them.
 * Flag carried forward — see directive Q6 / Discovery Report.
 */

export const revalidate = 3600;

type Params = { city: string };

export async function generateStaticParams(): Promise<Params[]> {
  try {
    const meta = await getMetadata();
    return meta.cities.map((c) => ({ city: c.slug }));
  } catch {
    // Build-time fallback — if API unreachable during build, defer to runtime
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { city } = await params;

  // Resolve city slug to display name via getMetadata (React.cache shared
  // with validateCitySlug below). Discovery Q1: previous version used the
  // raw slug ('minsk') in the title — display name ('Минск') is correct.
  let cityName = city;
  try {
    const meta = await getMetadata();
    cityName = meta.cities.find((c) => c.slug === city)?.name ?? city;
  } catch {
    // Metadata fetch failed — fall back to raw slug. validateCitySlug in
    // the page body will 404 cleanly if the slug truly doesn't exist.
  }

  const title = `Заведения в городе ${cityName}`;
  const description = `Каталог ресторанов, кафе и баров — ${cityName}. Рейтинги, акции, контакты.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/${city}`,
    },
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { city } = await params;

  const isValid = await validateCitySlug(city);
  if (!isValid) {
    notFound();
  }

  const meta = await getMetadata();

  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-l p-l'>
      <header className='flex flex-col gap-s'>
        <p className='text-caption-l text-muted-foreground'>Город</p>
        <h1 className='text-display-s font-display'>{city}</h1>
        <p className='text-body-m text-muted-foreground'>
          Foundation placeholder — Brief 2 scaffold. Catalog rendering arrives in Brief 3.
        </p>
      </header>
      <section className='flex flex-col gap-m'>
        <h2 className='text-headline-m'>Категории</h2>
        <ul className='flex flex-wrap gap-s'>
          {meta.categories.map((cat) => (
            <li key={cat.slug}>
              <Link
                href={`/${city}/${cat.slug}`}
                className='inline-flex rounded-m border border-border px-m py-s text-body-m hover:bg-muted transition-colors'
              >
                {cat.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
