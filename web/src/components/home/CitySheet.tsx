'use client';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { MetadataSlug } from '@/lib/api/types';
import { cn } from '@/lib/utils';

type Props = {
  cities: MetadataSlug[];
  value: string;
  onChange: (slug: string) => void;
};

/*
 * City selector as a LEFT-side sheet — mirrors the HeroFilters panel so both
 * hero pills («Город» + «Фильтры») share one open-panel animation and identical
 * trigger geometry (fixes the earlier height mismatch a dropdown introduced).
 * Single-select: picking a city applies it (onChange) and closes the sheet
 * (SheetClose wraps each option, composing its close with our onClick). City is
 * CONTEXT on the home hero — it does not navigate; only the orange Search does —
 * so onChange merely updates the shared selected-city state.
 *
 * Note: the option size token (text-body-m) lives on the grid container so the
 * whole option grid shares one size declaration; the per-button cn() carries
 * only color/border tokens. (Historically this also dodged a tailwind-merge bug
 * that dropped a size token sitting next to a color token in one cn(); cn() now
 * extends tailwind-merge to prevent that — see lib/utils.ts and
 * feedback_tailwind_merge_text_token — so an inline size token would work too.)
 */
export function CitySheet({ cities, value, onChange }: Props) {
  const current = cities.find((c) => c.slug === value);

  return (
    <Sheet>
      <SheetTrigger className="flex items-center gap-s rounded-2xl border border-white/70 px-l py-s text-label-l text-white transition-colors hover:bg-white/10">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        {current?.name ?? 'Город'}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </SheetTrigger>

      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto p-l sm:max-w-sm"
      >
        <SheetHeader className="p-0 pb-l">
          <SheetTitle>Выберите город</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-s text-body-m">
          {cities.map((c) => {
            const active = c.slug === value;
            return (
              <SheetClose
                key={c.slug}
                render={
                  <button
                    type="button"
                    onClick={() => onChange(c.slug)}
                    className={cn(
                      'rounded-2xl border p-m text-center transition-colors',
                      active
                        ? 'border-brand bg-brand/10 text-foreground'
                        : 'border-border bg-background text-text-secondary hover:bg-muted',
                    )}
                  >
                    {c.name}
                  </button>
                }
              />
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
