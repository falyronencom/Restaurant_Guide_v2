'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from './AuthProvider';

/*
 * Header login/account affordance — client island in the (public) layout.
 * The layout itself stays a Server Component; only this island is 'use client'.
 * Slice 2: the header no longer triggers sign-in flows itself — «Войти» links
 * to /login (all three methods live there), carrying the current path as
 * returnTo. Login errors render on the /login page, not in the header.
 */
export function AuthMenu() {
  const { status, user, logout } = useAuth();
  // returnTo: the path the user is on when they head to /login. On the auth
  // pages themselves fall back to '/' — linking /login?returnTo=/login would
  // bounce a successful sign-in right back to the form. Accepted loss: an
  // existing ?returnTo on /login|/register is dropped if the user clicks the
  // header «Войти» instead of the form (reading it would need useSearchParams
  // + a Suspense boundary in the layout header — not worth the micro-case).
  const pathname = usePathname();

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

  const onAuthPage =
    pathname.startsWith('/login') || pathname.startsWith('/register');
  const loginHref =
    onAuthPage || pathname === '/'
      ? '/login'
      : `/login?returnTo=${encodeURIComponent(pathname)}`;

  return (
    <Link
      href={loginHref}
      className="rounded-s bg-brand px-m py-1.5 text-body-m font-medium text-text-on-primary transition-colors hover:bg-brand-dark"
    >
      Войти
    </Link>
  );
}
