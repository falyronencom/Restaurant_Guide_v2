'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';

/**
 * ReviewsRetry — the «Все отзывы» page's notice when its reviews fetch failed
 * (сверка находок тестировщика с сайтом, 18.10, Х5 / Х23). The page is
 * force-dynamic, so `router.refresh()` re-renders it on the server with a
 * fresh fetch; the title and crumbs stay on screen meanwhile.
 */
export function ReviewsRetry() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role='alert'
      className='flex flex-wrap items-center justify-between gap-m rounded-[var(--radius-l)] border border-border bg-figma-bg-warm p-l'
    >
      <p className='text-body-m text-foreground'>
        Не удалось загрузить отзывы.
      </p>
      <Button
        variant='outline'
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? 'Загружаем…' : 'Повторить'}
      </Button>
    </div>
  );
}
