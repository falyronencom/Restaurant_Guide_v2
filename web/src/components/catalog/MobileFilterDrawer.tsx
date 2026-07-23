'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { MetadataSlug } from '@/lib/api/types';
import { buildResultsHref } from '@/lib/catalog-href';
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
 * BATCH model (distinct from the desktop shelf's live-navigate). In a full-screen
 * sheet the results are hidden behind the panel, so navigating on every tap is
 * both wasteful and race-prone: under network latency a fast re-tap / «Сбросить»
 * would act on a stale, still-in-flight `selected` (the prod-only symptoms this
 * replaces — category kicking you out, «Сбросить» / double-tap missing). Instead
 * the sheet drives FilterShelf in controlled mode: every toggle mutates a LOCAL
 * draft instantly (no navigation, no race), and a SINGLE «Применить» commits the
 * whole draft as one router.push — landing the results on the same screen.
 *
 * Chrome mirrors the home HeroFilters panel: back-chevron · centered title ·
 * «Сбросить» header, and a bottom «Применить». «Сбросить» clears the draft in
 * place (no navigation); the back-chevron closes without applying. The open state
 * is controlled so opening always re-seeds the draft from the live URL (props) —
 * abandoned edits from a previous open are discarded; the URL stays the truth.
 *
 * Placed next to the city pill in the catalog hero (CatalogSearch).
 */
export function MobileFilterDrawer({
  triggerClassName = DEFAULT_TRIGGER,
  ...props
}: Props) {
  const router = useRouter();
  const { citySlug, activeCategorySlug, searchParams, cuisineOptions, selected } =
    props;

  const [open, setOpen] = useState(false);
  // Local draft — the batch selection. Seeded from the URL-derived props and
  // mutated instantly on each toggle; only «Применить» writes it to the URL.
  const [draft, setDraft] = useState(selected);
  const [categorySlug, setCategorySlug] = useState(activeCategorySlug);

  function handleOpenChange(next: boolean) {
    // Re-seed from the live URL every time the sheet opens: the results may have
    // changed since last time, and any abandoned draft edits are dropped.
    if (next) {
      setDraft(selected);
      setCategorySlug(activeCategorySlug);
    }
    setOpen(next);
  }

  function handleApply() {
    router.push(
      buildResultsHref({
        citySlug,
        categorySlug,
        selected: draft,
        searchParams,
        cuisineCount: cuisineOptions.length,
      }),
    );
    setOpen(false);
  }

  function handleReset() {
    setDraft({ cuisines: [], priceRange: [], features: [], hours: undefined });
    setCategorySlug(undefined);
  }

  const hasFilters =
    categorySlug !== undefined ||
    draft.cuisines.length > 0 ||
    draft.priceRange.length > 0 ||
    draft.features.length > 0 ||
    draft.hours !== undefined;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
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
            onClick={handleReset}
            disabled={!hasFilters}
            className="justify-self-end text-body-m text-brand transition-colors hover:text-brand-dark disabled:text-text-tertiary"
          >
            Сбросить
          </button>
        </SheetHeader>

        <FilterShelf
          {...props}
          selected={draft}
          activeCategorySlug={categorySlug}
          onSelectedChange={setDraft}
          onCategoryChange={setCategorySlug}
        />

        <button
          type="button"
          onClick={handleApply}
          className="mt-m w-full rounded-2xl bg-brand px-l py-m text-label-l text-white transition-colors hover:bg-brand-dark"
        >
          Применить
        </button>
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
