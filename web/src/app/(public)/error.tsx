'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/client-error-reporter';

/*
 * Error boundary for (public) routes. Must be a Client Component (Next.js
 * error boundary requirement). Receives `error` + `unstable_retry` from
 * Next 16 runtime.
 *
 * Errors are beaconed to /api/client-error (operator-visible in Railway
 * logs — OSB-P6 вариант B); full Sentry remains a post-launch option.
 */
export default function PublicError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('Public route error:', error);
    reportClientError(error);
  }, [error]);

  return (
    <main className='flex flex-1 flex-col items-center justify-center gap-m p-l text-center'>
      <h2 className='text-display-s font-display'>Что-то пошло не так</h2>
      <p className='text-body-l text-muted-foreground max-w-md'>
        {error.message || 'Внутренняя ошибка. Попробуйте обновить страницу.'}
      </p>
      <Button onClick={() => unstable_retry()} variant='default'>
        Попробовать снова
      </Button>
    </main>
  );
}
