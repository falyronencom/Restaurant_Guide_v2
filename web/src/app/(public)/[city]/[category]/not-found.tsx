import Link from 'next/link';

/*
 * /[city]/[category]/not-found.tsx — surfaces when validateCategorySlug()
 * (or validateCitySlug at this level) rejects the slug. Symmetric with
 * [city]/not-found.tsx. Note: route params are not directly accessible
 * here, so we link back to root rather than the parent city overview.
 */
export default function CategoryNotFound() {
  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-m p-l text-center'>
      <h1 className='text-display-s font-display'>Категория не найдена</h1>
      <p className='max-w-md text-body-l text-muted-foreground'>
        Такой категории нет в нашем каталоге. Попробуйте выбрать категорию
        с главной страницы города.
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
