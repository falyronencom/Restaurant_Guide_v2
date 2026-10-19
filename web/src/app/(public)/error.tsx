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
const PUBLIC_ERROR_TEXT =
  'Не удалось загрузить страницу. Попробуйте ещё раз — обычно это помогает.';

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
      {/* Always our own Russian text, never error.message: for a Server
          Component failure Next replaces the message with an English
          production notice, and a client-side exception text is not meant
          for visitors either. The real error goes to reportClientError. */}
      <p className='text-body-l text-muted-foreground max-w-md'>
        {PUBLIC_ERROR_TEXT}
      </p>
      <Button onClick={() => unstable_retry()} variant='default'>
        Попробовать снова
      </Button>
    </main>
  );
}
