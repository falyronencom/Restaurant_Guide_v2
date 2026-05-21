import Link from 'next/link';

/*
 * Root /not-found.tsx — fallback 404 for routes outside the (public) subtree.
 * Triggered by Next when no matching segment is found OR explicit notFound()
 * call in a non-(public) route.
 */
export default function RootNotFound() {
  return (
    <main className='flex flex-1 flex-col items-center justify-center gap-m p-l text-center'>
      <h1 className='text-display-s font-display'>404</h1>
      <p className='text-body-l text-muted-foreground'>
        Страница не найдена.
      </p>
      <Link href='/' className='text-primary underline-offset-4 hover:underline'>
        На главную
      </Link>
    </main>
  );
}
