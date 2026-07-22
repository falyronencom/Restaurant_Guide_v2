'use client';

import { useRouter } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/*
 * Catalog sort dropdown — client island. Mutates the `sort_by` query param and
 * the Server Component re-fetches (same URL contract as FilterShelf): preserve
 * sibling params, reset `page`, and omit `sort_by` for the default ('rating')
 * to keep the canonical URL clean.
 *
 * Values match the backend's buildOrderByClause (searchService.js): 'rating',
 * 'price_asc', 'price_desc'. Distance sort is geo-only — excluded on the web
 * catalog, which has no client location.
 *
 * Rendered with the themed base-ui Select (ui/select) rather than a native
 * <select>: the native option popup is OS-chrome (unstyled) and clashed with the
 * brand UI; the base-ui popup inherits our tokens.
 */

const SORT_OPTIONS = [
  { value: 'rating', label: 'по рейтингу' },
  { value: 'price_asc', label: 'сначала дешевле' },
  { value: 'price_desc', label: 'сначала дороже' },
] as const;

// Value→label map so <SelectValue> renders the label of the current selection.
const SORT_ITEMS: Record<string, string> = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.value, o.label]),
);

type Props = {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export function SortSelect({ basePath, searchParams }: Props) {
  const router = useRouter();
  const current =
    typeof searchParams.sort_by === 'string' ? searchParams.sort_by : 'rating';

  function handleChange(next: string) {
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
    <div className='flex shrink-0 items-center gap-2 text-body-m text-muted-foreground'>
      <span>Сортировать:</span>
      <Select
        value={current}
        onValueChange={(value) => handleChange(value as string)}
        items={SORT_ITEMS}
      >
        <SelectTrigger
          aria-label='Сортировка'
          className='font-semibold text-foreground'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
