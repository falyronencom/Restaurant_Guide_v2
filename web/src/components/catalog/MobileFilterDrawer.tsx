import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { FacetOption } from '@/lib/facets';

import { FilterShelf } from './FilterShelf';

type Props = {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  cuisineOptions: readonly FacetOption[];
  selected: { cuisines: string[]; priceRange: string[]; hours: string | undefined };
};

/*
 * Mobile-only filter affordance: a "Фильтры" trigger that opens the FilterShelf
 * inside a left sheet drawer. Desktop renders the shelf directly in a sticky
 * <aside> (see ResultsView), so this whole control is lg:hidden.
 *
 * Uncontrolled (base-ui Dialog manages its own open state). FilterShelf
 * navigates (router.push) on each toggle; the drawer stays mounted across the
 * soft navigation (same route segment), so the user can toggle several facets
 * before dismissing via the close button or backdrop.
 */
export function MobileFilterDrawer(props: Props) {
  return (
    <div className="mb-m lg:hidden">
      <Sheet>
        <SheetTrigger className="inline-flex items-center gap-s rounded-full border border-border bg-background px-l py-m text-label-l text-foreground shadow-sm transition-colors hover:bg-muted">
          <FilterIcon />
          Фильтры
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-80 max-w-[85vw] gap-0 overflow-y-auto p-l"
        >
          <SheetHeader className="p-0 pb-m">
            <SheetTitle>Фильтры</SheetTitle>
          </SheetHeader>
          <FilterShelf {...props} />
        </SheetContent>
      </Sheet>
    </div>
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
