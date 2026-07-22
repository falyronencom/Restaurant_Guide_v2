import {
  Sheet,
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
 * trigger that opens the FilterShelf inside a full-screen right sheet. Desktop
 * renders the shelf directly in a sticky <aside> (see ResultsView).
 *
 * Uncontrolled (base-ui Dialog manages its own open state). FilterShelf
 * navigates (router.push) on each toggle; the drawer stays mounted across the
 * soft navigation (same route segment), so the user can toggle several facets
 * before dismissing via the close button or backdrop.
 *
 * Now placed next to the city pill in the catalog hero (CatalogSearch) so the
 * results hero mirrors the home hero — city + filters together.
 */
export function MobileFilterDrawer({
  triggerClassName = DEFAULT_TRIGGER,
  ...props
}: Props) {
  return (
    <Sheet>
      <SheetTrigger className={triggerClassName}>
        <FilterIcon />
        Фильтры
      </SheetTrigger>
      <SheetContent
        side="right"
        // Full-screen on phones: the sheet default carries `data-[side=right]:w-3/4`,
        // so override at the same variant (tailwind-merge replaces it). The default
        // `sm:max-w-sm` still caps it to a panel on tablet/desktop.
        className="gap-0 overflow-y-auto p-l data-[side=right]:w-full"
      >
        <SheetHeader className="p-0 pb-m">
          <SheetTitle>Фильтры</SheetTitle>
        </SheetHeader>
        <FilterShelf {...props} />
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
