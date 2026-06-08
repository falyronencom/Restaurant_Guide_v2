import Link from 'next/link';

import { AuthMenu } from '@/components/auth/AuthMenu';

/*
 * Public route group layout — shared chrome for the geographic route
 * subtree (/[city], /[city]/[category], /[city]/[category]/[slug]).
 *
 * Brief 2: minimal header + content slot. No real navigation yet — Brief 3
 * adds breadcrumbs, search input, filter shelf.
 */
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className='border-b border-border bg-background'>
        <div className='mx-auto flex max-w-6xl items-center justify-between gap-l px-l py-m'>
          <Link
            href='/'
            className='font-display text-headline-m text-foreground hover:text-brand-dark transition-colors'
          >
            Nirivio
          </Link>
          <AuthMenu />
        </div>
      </header>
      <div className='flex flex-1 flex-col'>{children}</div>
    </>
  );
}
