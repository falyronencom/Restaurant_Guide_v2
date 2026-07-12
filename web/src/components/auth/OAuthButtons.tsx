'use client';

import { Button } from '@/components/ui/button';
import { startYandexLogin } from '@/lib/auth/actions';

import { useAuth } from './AuthProvider';

/*
 * OAuth section of /login and /register — both providers, sharing the page's
 * guarded returnTo. Google goes through the existing AuthProvider GIS flow
 * (success lands in the context → AuthRedirect navigates); Yandex is the
 * Slice 1 Server-Action redirect flow, untouched (its callback handles
 * returnTo via the y_state cookie). Google errors surface through the
 * context's loginError, exactly as they did in the header before Slice 2.
 */
export function OAuthButtons({ returnTo }: { returnTo: string }) {
  const { requestLogin, loginError } = useAuth();

  return (
    <div className="flex flex-col gap-s">
      <Button
        type="button"
        variant="outline"
        size="cta"
        className="w-full"
        onClick={requestLogin}
      >
        Войти через Google
      </Button>
      <form action={startYandexLogin}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <Button type="submit" variant="outline" size="cta" className="w-full">
          Войти через Яндекс
        </Button>
      </form>
      {loginError ? (
        <p aria-live="polite" className="text-caption-l text-destructive">
          {loginError}
        </p>
      ) : null}
    </div>
  );
}
