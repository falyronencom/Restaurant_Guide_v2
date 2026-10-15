import { CatalogBackLink } from '@/components/catalog/CatalogBackLink';
import { NOT_FOUND_TITLE } from '@/lib/not-found-titles';

/*
 * /[city]/[category]/not-found.tsx — surfaces when validateCategorySlug()
 * (or validateCitySlug at this level) rejects the slug. Symmetric with
 * [city]/not-found.tsx. Route params are not props here; CatalogBackLink
 * reads them from the address and leads to the city (or home, when the city
 * is unknown too) — never to the category that was not found.
 */
export default function CategoryNotFound() {
  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-m p-l text-center'>
      <h1 className='text-display-s font-display'>
        {NOT_FOUND_TITLE.category}
      </h1>
      <p className='max-w-md text-body-l text-muted-foreground'>
        Такой категории нет в нашем каталоге. Попробуйте выбрать категорию
        с главной страницы города.
      </p>
      <CatalogBackLink cityOnly />
    </main>
  );
}
