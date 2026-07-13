import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

/**
 * CatalogPagination — minimal previous/next + current/total indicator.
 *
 * Hand-rolled rather than wrapping shadcn `Pagination` (which uses base-ui
 * Button render protocol and would need awkward Link injection). Brief 3
 * baseline does not need a numbered page list — prev/next + indicator is
 * sufficient at the catalog's expected scale (~19 pages for largest city
 * in current production data).
 *
 * URL contract: preserves all current search params except `page`; sets
 * `page=N` only when N > 1 (page 1 = canonical URL without ?page=1).
 *
 * Russian labels per directive (F5 — shadcn defaults "Previous"/"Next").
 */
export function CatalogPagination({
  currentPage,
  totalPages,
  basePath,
  searchParams,
}: {
  currentPage: number;
  totalPages: number;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (totalPages <= 1) return null;

  const prevPage = currentPage > 1 ? currentPage - 1 : null;
  const nextPage = currentPage < totalPages ? currentPage + 1 : null;

  const linkBase =
    'inline-flex items-center gap-1 rounded-[var(--radius-s)] border border-border bg-background px-m py-s text-body-m text-foreground transition-colors hover:bg-muted';
  const disabledBase =
    'inline-flex items-center gap-1 rounded-[var(--radius-s)] border border-border bg-background px-m py-s text-body-m text-muted-foreground opacity-50 cursor-not-allowed';

  return (
    <nav
      aria-label='Постраничная навигация'
      className='flex items-center justify-center gap-m'
    >
      {prevPage ? (
        <Link
          href={buildHref(basePath, prevPage, searchParams)}
          className={linkBase}
          rel='prev'
        >
          <ChevronLeftIcon className='size-4' aria-hidden='true' />
          Назад
        </Link>
      ) : (
        <span className={disabledBase} aria-disabled='true'>
          <ChevronLeftIcon className='size-4' aria-hidden='true' />
          Назад
        </span>
      )}

      <span className='text-body-m text-muted-foreground'>
        Страница {currentPage} из {totalPages}
      </span>

      {nextPage ? (
        <Link
          href={buildHref(basePath, nextPage, searchParams)}
          className={linkBase}
          rel='next'
        >
          Вперёд
          <ChevronRightIcon className='size-4' aria-hidden='true' />
        </Link>
      ) : (
        <span className={disabledBase} aria-disabled='true'>
          Вперёд
          <ChevronRightIcon className='size-4' aria-hidden='true' />
        </span>
      )}
    </nav>
  );
}

/**
 * Build a paginated href preserving existing search params (except `page`,
 * which is replaced). Page 1 is rendered without a `page=` param to keep
 * the canonical URL clean.
 */
function buildHref(
  basePath: string,
  page: number,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page') continue;
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, value);
    }
  }
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
