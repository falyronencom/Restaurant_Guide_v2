import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { getLiveCities } from '@/lib/api/endpoints/metadata';

/*
 * Public route group layout — the unified site shell for the home, city and
 * catalog routes (and, per D-A, /login + /register, which also live here).
 *
 * Stays a Server Component and reads NO cookies/headers, so the public subtree
 * remains statically rendered with ISR (revalidate below). City metadata is
 * fetched once here (memoized via React.cache in getLiveCities, shared with the
 * child pages) and passed to the header/footer.
 */
export const revalidate = 3600;

export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Only cities with cards (getLiveCities — Coordinator decision 01.10, А2).
  const cities = await getLiveCities();

  return (
    <>
      <SiteHeader />
      <div className='flex flex-1 flex-col'>{children}</div>
      <SiteFooter cities={cities} />
    </>
  );
}
