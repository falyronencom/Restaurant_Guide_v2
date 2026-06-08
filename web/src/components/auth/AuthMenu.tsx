'use client';

import { useAuth } from './AuthProvider';

/*
 * Header login/account affordance — client island in the (public) layout.
 * The layout itself stays a Server Component; only this island is 'use client'.
 */
export function AuthMenu() {
  const { status, user, requestLogin, logout, loginError } = useAuth();

  // Reserve space while the session hydrates to avoid a layout shift.
  if (status === 'loading') {
    return <div className="h-9 w-24" aria-hidden />;
  }

  if (status === 'authenticated' && user) {
    return (
      <div className="flex items-center gap-s">
        <span className="hidden max-w-[12rem] truncate text-body-m text-foreground sm:inline">
          {user.name || user.email}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-body-m text-figma-text-grey transition-colors hover:text-brand-dark"
        >
          Выйти
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={requestLogin}
        className="rounded-s bg-brand px-m py-1.5 text-body-m font-medium text-text-on-primary transition-colors hover:bg-brand-dark"
      >
        Войти
      </button>
      {loginError ? (
        <span className="text-caption-l text-destructive">{loginError}</span>
      ) : null}
    </div>
  );
}
