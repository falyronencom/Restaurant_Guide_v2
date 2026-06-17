'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

import { useAuth } from './AuthProvider';

type Props = {
  /* On the home hero the header is a transparent overlay → light account text. */
  overlay?: boolean;
};

/*
 * Header login/account affordance — client island in the (public) layout.
 * The layout itself stays a Server Component; only this island is 'use client'.
 * Slice 2: the header no longer triggers sign-in flows itself — «Войти» links
 * to /login (all three methods live there), carrying the current path as
 * returnTo. Login errors render on the /login page, not in the header.
 *
 * overlay: on the home hero the header sits transparent over a dark photo, so
 * the authenticated account text switches to light. The «Войти» button is brand
 * orange in both variants (already legible on the hero), so it does not change.
 */
export function AuthMenu({ overlay = false }: Props) {
  const { status, user, logout } = useAuth();
  const pathname = usePathname();

  // Reserve space while the session hydrates to avoid a layout shift.
  if (status === 'loading') {
    return <div className="h-9 w-24" aria-hidden />;
  }

  if (status === 'authenticated' && user) {
    return (
      <div className="flex items-center gap-s">
        <span
          className={cn(
            'hidden max-w-[12rem] truncate text-body-m sm:inline',
            overlay ? 'text-white' : 'text-foreground',
          )}
        >
          {user.name || user.email}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className={cn(
            'text-body-m transition-colors',
            overlay
              ? 'text-white/90 hover:text-white'
              : 'text-figma-text-grey hover:text-brand-dark',
          )}
        >
          Выйти
        </button>
      </div>
    );
  }

  // returnTo: the path the user is on when they head to /login. On the auth
  // pages themselves (and the home page) fall back to '/' — linking
  // /login?returnTo=/login would bounce a successful sign-in back to the form.
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
