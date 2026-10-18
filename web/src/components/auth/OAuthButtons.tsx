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
export function OAuthButtons({
  returnTo,
  redirectError = null,
}: {
  returnTo: string;
  /**
   * A failure that arrived with the page address — a failed Yandex sign-in
   * (`?auth_error=`, read by /login). A newer Google error takes its place.
   */
  redirectError?: string | null;
}) {
  const { requestLogin, loginError } = useAuth();
  const error = loginError ?? redirectError;

  return (
    <div className="flex flex-col gap-s">
      <Button
        type="button"
        variant="outline"
        size="cta"
        className="w-full"
        onClick={() => requestLogin()}
      >
        Войти через Google
      </Button>
      <form action={startYandexLogin}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <Button type="submit" variant="outline" size="cta" className="w-full">
          Войти через Яндекс
        </Button>
      </form>
      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-caption-l text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
