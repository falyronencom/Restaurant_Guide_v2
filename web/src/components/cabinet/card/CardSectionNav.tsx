'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { tabsListVariants } from '@/components/ui/tabs';
import { CARD_SECTIONS, cardSectionHref, cardSectionOf } from '@/lib/partner/card-sections';
import { cn } from '@/lib/utils';

/*
 * The row of a card's sections — «Карточка», «Меню» (lib/partner/card-sections
 * — one list, the next parts add theirs). Links, not stateful tabs: each
 * section is a page of its own. The look is the cabinet list's line tabs
 * (TabsList variant="line"); the current section — aria-current="page".
 */
export function CardSectionNav({ id }: { id: string }) {
  const current = cardSectionOf(usePathname());
  return (
    <nav aria-label="Разделы карточки" className="border-b border-border">
      <div data-variant="line" className={cn(tabsListVariants({ variant: 'line' }), 'h-9 gap-m p-0')}>
        {CARD_SECTIONS.map((section) => {
          const active = section.segment === current;
          return (
            <Link
              key={section.segment}
              href={cardSectionHref(id, section.segment)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative inline-flex h-full items-center px-1 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground',
                active
                  ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground'
                  : 'text-foreground/60',
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
