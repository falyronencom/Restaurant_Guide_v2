'use client';

import { useRouter } from 'next/navigation';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { MetadataSlug } from '@/lib/api/types';
import type { FacetOption } from '@/lib/facets';

import { FilterShelf } from './FilterShelf';

type Props = {
  citySlug: string;
  categories: MetadataSlug[];
  activeCategorySlug?: string;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  cuisineOptions: readonly FacetOption[];
  selected: {
    cuisines: string[];
    priceRange: string[];
    features: string[];
    hours: string | undefined;
  };
  /** Override the trigger pill styling — e.g. the catalog hero's glass variant.
   *  Defaults to a solid white-outline button. */
  triggerClassName?: string;
};

const DEFAULT_TRIGGER =
  'inline-flex items-center gap-s rounded-2xl border border-border bg-background px-l py-m text-label-l text-foreground shadow-sm transition-colors hover:bg-muted';

/*
 * Mobile/tablet filter affordance (the caller applies `lg:hidden`): a «Фильтры»
 * trigger opening the FilterShelf inside a full-screen right sheet. Desktop
 * renders the shelf directly in a sticky <aside> (see ResultsView).
 *
 * Chrome mirrors the home HeroFilters panel: back-chevron · centered title ·
 * «Сбросить» header, and a bottom «Применить». Unlike the home panel (a
 * pre-search refinement), the catalog facets navigate LIVE on each toggle
 * (FilterShelf → router.push), so the results already update behind the now
 * full-screen sheet — «Применить» simply closes it to reveal them on the same
 * screen. «Сбросить» clears the query facets (navigate to the clean basePath,
 * keeping the category route).
 *
 * Placed next to the city pill in the catalog hero (CatalogSearch).
 */
export function MobileFilterDrawer({
  triggerClassName = DEFAULT_TRIGGER,
  ...props
}: Props) {
  const router = useRouter();
  const { selected, basePath } = props;
  const hasFilters =
    selected.cuisines.length > 0 ||
    selected.priceRange.length > 0 ||
    selected.features.length > 0 ||
    selected.hours !== undefined;

  return (
    <Sheet>
      <SheetTrigger className={triggerClassName}>
        <FilterIcon />
        Фильтры
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        // Full-screen on phones (override the sheet's data-[side=right]:w-3/4 at
        // the same variant); the default sm cap keeps a panel on tablet/desktop.
        className="gap-0 overflow-y-auto p-l data-[side=right]:w-full"
      >
        <SheetHeader className="grid grid-cols-3 items-center p-0 pb-l">
          <SheetClose
            aria-label="Назад"
            className="justify-self-start text-foreground transition-colors hover:text-brand"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-6"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </SheetClose>
          <SheetTitle className="text-center">Фильтры</SheetTitle>
          <button
            type="button"
            onClick={() => router.push(basePath)}
            disabled={!hasFilters}
            className="justify-self-end text-body-m text-brand transition-colors hover:text-brand-dark disabled:text-text-tertiary"
          >
            Сбросить
          </button>
        </SheetHeader>

        <FilterShelf {...props} />

        <SheetClose className="mt-m w-full rounded-2xl bg-brand px-l py-m text-label-l text-white transition-colors hover:bg-brand-dark">
          Применить
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}
