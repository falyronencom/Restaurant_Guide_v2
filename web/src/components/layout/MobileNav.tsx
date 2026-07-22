'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu as MenuIcon } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth/AuthProvider';

type Props = {
  /* On the home hero the header is a transparent overlay → light burger. */
  overlay?: boolean;
};

const itemClass =
  'rounded-[var(--radius-s)] px-3 py-2.5 text-body-l text-foreground no-underline transition-colors hover:bg-muted';

/*
 * Mobile header navigation — burger button → right-side sheet drawer.
 *
 * The desktop header lays «Стать партнёром» + the account control in a row; on a
 * phone that row does not fit (and overflowing it pushed a horizontal scroll on
 * the whole page). Below `md` the header collapses to a single burger, and every
 * action lives inside the sheet. This keeps the header itself to one short row
 * (stable 72px height, which the hero's -mt-[72px] pull-up depends on).
 *
 * Client island: it owns the open state and reads useAuth for the account
 * section. The (public) layout stays a Server Component (the header islands read
 * no cookies/headers).
 */
export function MobileNav({ overlay = false }: Props) {
  const { status, user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  // «Войти» returnTo — mirror AuthMenu: home/auth pages fall back to /login.
  const onAuthPage =
    pathname.startsWith('/login') || pathname.startsWith('/register');
  const loginHref =
    onAuthPage || pathname === '/'
      ? '/login'
      : `/login?returnTo=${encodeURIComponent(pathname)}`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Открыть меню"
        className={cn(
          'flex size-10 items-center justify-center rounded-lg outline-none transition-colors',
          overlay
            ? 'text-white hover:bg-white/10'
            : 'text-foreground hover:bg-muted',
        )}
      >
        <MenuIcon className="size-6" aria-hidden />
      </SheetTrigger>

      <SheetContent side="right" className="w-72 gap-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Меню</SheetTitle>
        </SheetHeader>

        <nav className="flex flex-col gap-1 p-3">
          <Link
            href="/login?returnTo=/cabinet/new"
            onClick={close}
            className={itemClass}
          >
            Стать партнёром
          </Link>

          {status === 'authenticated' && user ? (
            <>
              <div className="mt-2 truncate border-t border-border px-3 pt-3 pb-1 text-body-s text-muted-foreground">
                {user.name || user.email}
              </div>
              <Link href="/favorites" onClick={close} className={itemClass}>
                Избранное
              </Link>
              <Link href="/profile" onClick={close} className={itemClass}>
                Профиль
              </Link>
              <button
                type="button"
                onClick={() => {
                  close();
                  void logout();
                }}
                className={cn(itemClass, 'w-full text-left')}
              >
                Выйти
              </button>
            </>
          ) : status === 'anonymous' ? (
            <Link href={loginHref} onClick={close} className={itemClass}>
              Войти
            </Link>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
