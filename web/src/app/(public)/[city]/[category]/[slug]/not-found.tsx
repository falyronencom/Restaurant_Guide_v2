import { CatalogBackLink } from '@/components/establishment/CatalogBackLink';

/*
 * /[city]/[category]/[slug]/not-found.tsx — surfaces when the establishment
 * page or its all-reviews page calls notFound(): the backend answers 404 both
 * for an unknown slug and for a card that is not active (suspended by a
 * moderator, archived, still in moderation), or the city/category part of the
 * address is unknown. Without this file Next fell through to
 * [category]/not-found.tsx and the guest read «Категория не найдена».
 */
export default function EstablishmentNotFound() {
  return (
    <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-m p-l text-center'>
      <h1 className='text-display-s font-display'>Заведение не найдено</h1>
      <p className='max-w-md text-body-l text-muted-foreground'>
        Возможно, оно закрылось, временно недоступно или ссылка устарела.
      </p>
      <CatalogBackLink />
    </main>
  );
}
