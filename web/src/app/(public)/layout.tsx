import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { getMetadata } from '@/lib/api/endpoints/metadata';

/*
 * Public route group layout — the unified site shell for the home, city and
 * catalog routes (and, per D-A, /login + /register, which also live here).
 *
 * Stays a Server Component and reads NO cookies/headers, so the public subtree
 * remains statically rendered with ISR (revalidate below). City metadata is
 * fetched once here (memoized via React.cache in getMetadata, shared with the
 * child pages) and passed to the header/footer.
 */
export const revalidate = 3600;

export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { cities } = await getMetadata();

  return (
    <>
      <SiteHeader />
      <div className='flex flex-1 flex-col'>{children}</div>
      <SiteFooter cities={cities} />
    </>
  );
}
