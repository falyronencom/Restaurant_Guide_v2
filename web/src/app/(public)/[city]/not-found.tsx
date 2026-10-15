import Link from 'next/link';

import { NOT_FOUND_TITLE } from '@/lib/not-found-titles';

/*
 * /[city]/not-found.tsx — surfaces when validateCitySlug() rejects the
 * params.city value. Scoped 404 (city subtree only); other 404s fall to
 * the (public) group or root not-found.
 */
export default function CityNotFound() {
  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-m p-l text-center'>
      <h1 className='text-display-s font-display'>{NOT_FOUND_TITLE.city}</h1>
      <p className='text-body-l text-muted-foreground max-w-md'>
        Такого города нет в нашем каталоге. Попробуйте выбрать из списка
        на главной.
      </p>
      <Link
        href='/'
        className='text-primary underline-offset-4 hover:underline'
      >
        На главную
      </Link>
    </main>
  );
}
