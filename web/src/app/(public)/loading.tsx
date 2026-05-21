import { Skeleton } from '@/components/ui/skeleton';

/*
 * Suspense fallback for (public) routes during navigation. Skeleton-only
 * placeholder — Brief 3 will tune per-route loading UX once real content
 * blocks exist.
 */
export default function PublicLoading() {
  return (
    <main className='flex flex-1 flex-col gap-l p-l'>
      <Skeleton className='h-8 w-1/3' />
      <Skeleton className='h-4 w-2/3' />
      <div className='grid grid-cols-1 gap-m sm:grid-cols-2 lg:grid-cols-3'>
        <Skeleton className='h-32 w-full rounded-l' />
        <Skeleton className='h-32 w-full rounded-l' />
        <Skeleton className='h-32 w-full rounded-l' />
      </div>
    </main>
  );
}
