'use client';

import { useRouter } from 'next/navigation';

/*
 * Catalog sort dropdown — client island. Mutates the `sort_by` query param and
 * the Server Component re-fetches (same URL contract as FilterShelf): preserve
 * sibling params, reset `page`, and omit `sort_by` for the default ('rating')
 * to keep the canonical URL clean.
 *
 * Values match the backend's buildOrderByClause (searchService.js): 'rating',
 * 'price_asc', 'price_desc'. Distance sort is geo-only — excluded on the web
 * catalog, which has no client location.
 */

const SORT_OPTIONS = [
  { value: 'rating', label: 'по рейтингу' },
  { value: 'price_asc', label: 'сначала дешевле' },
  { value: 'price_desc', label: 'сначала дороже' },
] as const;

type Props = {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export function SortSelect({ basePath, searchParams }: Props) {
  const router = useRouter();
  const current =
    typeof searchParams.sort_by === 'string' ? searchParams.sort_by : 'rating';

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === 'page' || key === 'sort_by') continue;
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, v);
      } else {
        params.set(key, value);
      }
    }
    if (next !== 'rating') params.set('sort_by', next);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <label className='flex shrink-0 items-center gap-2 text-body-m text-muted-foreground'>
      Сортировать:
      <select
        value={current}
        onChange={onChange}
        aria-label='Сортировка'
        className='cursor-pointer bg-transparent font-semibold text-foreground outline-none'
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
