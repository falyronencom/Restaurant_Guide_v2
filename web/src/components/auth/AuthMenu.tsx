'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';

import { cn } from '@/lib/utils';

import { useAuth } from './AuthProvider';

type Props = {
  /* On the home hero the header is a transparent overlay → light trigger. */
  overlay?: boolean;
};

/*
 * Desktop account affordance — client island in the (public) header.
 *
 * Authenticated: a single dropdown (initial badge + name → chevron) opens a menu
 * with the account actions (Избранное / Профиль / Выйти). Collapsing the four
 * former inline items into one control removes the "which of these is even a
 * button?" ambiguity on desktop and keeps the header to a single row.
 *
 * Anonymous: the brand «Войти» button → /login, carrying the current path as
 * returnTo. Login errors render on /login, not in the header.
 *
 * The mobile header uses MobileNav (burger → sheet) instead; this control sits
 * in the header's `hidden md:flex` cluster, so it is only shown from md up.
 */
export function AuthMenu({ overlay = false }: Props) {
  const { status, user, logout } = useAuth();
  const pathname = usePathname();

  // Reserve space while the session hydrates to avoid a layout shift.
  if (status === 'loading') {
    return <div className="h-9 w-24" aria-hidden />;
  }

  if (status === 'authenticated' && user) {
    const label = user.name || user.email;
    const initial = (label.trim()[0] ?? '?').toUpperCase();
    const itemClass =
      'flex cursor-pointer items-center rounded-[var(--radius-s)] px-2.5 py-2 text-body-m text-foreground no-underline outline-none transition-colors hover:bg-muted focus:bg-muted';

    return (
      <Menu.Root>
        <Menu.Trigger
          className={cn(
            'flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-body-m outline-none transition-colors',
            overlay
              ? 'text-white hover:bg-white/10'
              : 'text-foreground hover:bg-muted',
          )}
        >
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded-full text-body-s font-semibold',
              overlay ? 'bg-white/20 text-white' : 'bg-brand/10 text-brand',
            )}
            aria-hidden
          >
            {initial}
          </span>
          <span className="max-w-[10rem] truncate">{label}</span>
          <ChevronDown className="size-4 opacity-70" aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            side="bottom"
            align="end"
            sideOffset={8}
            className="z-50 outline-none"
          >
            <Menu.Popup className="min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
              <div className="max-w-[12rem] truncate px-2.5 py-1.5 text-body-s text-muted-foreground">
                {label}
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item render={<Link href="/favorites" className={itemClass} />}>
                Избранное
              </Menu.Item>
              <Menu.Item render={<Link href="/profile" className={itemClass} />}>
                Профиль
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={itemClass} onClick={() => void logout()}>
                Выйти
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }

  // Anonymous → «Войти». Carry the current path as returnTo, except on the home
  // and auth pages (where returnTo=/login would bounce a successful sign-in).
  const onAuthPage =
    pathname.startsWith('/login') || pathname.startsWith('/register');
  const loginHref =
    onAuthPage || pathname === '/'
      ? '/login'
      : `/login?returnTo=${encodeURIComponent(pathname)}`;

  return (
    <Link
      href={loginHref}
      className="rounded-[10px] border border-transparent bg-brand px-m py-2 text-body-m font-medium text-text-on-primary transition-colors hover:bg-brand-dark"
    >
      Войти
    </Link>
  );
}
