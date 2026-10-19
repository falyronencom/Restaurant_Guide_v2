/**
 * The text menu (OCR) — the warm-beige card grouped by category, and the
 * «извлечено автоматически» chip that goes with it. Shared by MenuBlock (the
 * server-rendered page) and MenuLoadFailed (the client island that loads the
 * items itself when the page's own fetch failed), so both draw the same menu.
 * No hooks, no server-only imports: it renders on either side.
 */

import { AlertCircle, ChefHat } from 'lucide-react';

import type { PublicMenuItem } from '@/lib/api/types';

export function MenuAutoExtractedNote() {
  return (
    <span className='inline-flex items-center gap-1.5 rounded-[var(--radius-s)] bg-[#F7EFE6] px-2.5 py-1.5 text-body-s text-[#A07A52]'>
      <AlertCircle className='size-3.5 shrink-0' aria-hidden='true' />
      Меню извлечено автоматически — уточняйте у заведения
    </span>
  );
}

export function MenuItemsList({ menuItems }: { menuItems: PublicMenuItem[] }) {
  const groups = groupByCategory(menuItems);
  return (
    <div className='flex flex-col gap-6 rounded-card bg-figma-bg-warm p-l'>
      {groups.map((group) => (
        <div key={group.category ?? '__uncategorized__'}>
          {group.category ? (
            <h3 className='mb-2 flex items-center gap-2.5 font-display text-[15px] font-medium text-foreground'>
              <span className='flex size-[26px] shrink-0 items-center justify-center rounded-[var(--radius-s)] bg-background text-brand'>
                <ChefHat className='size-4' aria-hidden='true' />
              </span>
              {group.category}
            </h3>
          ) : null}
          <ul>
            {group.items.map((item) => (
              <li
                key={item.id}
                className='flex items-baseline gap-2.5 border-t border-figma-divider py-[11px]'
              >
                <span className='text-[15px] text-foreground'>
                  {item.item_name}
                  {item.quality_tier === 'needs_caution' ? (
                    <span
                      title='Эта позиция требует уточнения у заведения'
                      className='ml-2 inline-flex items-center gap-1 rounded-xs bg-background px-1.5 py-0.5 text-caption-s font-medium text-figma-text-dark'
                    >
                      <AlertCircle className='size-3' aria-hidden='true' />
                      уточнить
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden='true'
                  className='-translate-y-[3px] flex-1 border-b border-dotted border-[#CFC8BC]'
                />
                {/* No price (a dish inside a set) — a grey dash, so it does
                    not read as a price of its own (Design, 29.09.2026). */}
                <span
                  className={`whitespace-nowrap text-[15px] font-semibold ${
                    item.price_byn == null
                      ? 'text-figma-text-grey'
                      : 'text-foreground'
                  }`}
                >
                  {formatPrice(item.price_byn)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

type Group = {
  category: string | null;
  items: PublicMenuItem[];
};

function groupByCategory(items: PublicMenuItem[]): Group[] {
  const map = new Map<string | null, PublicMenuItem[]>();
  for (const item of items) {
    const key =
      item.category_raw && item.category_raw.length > 0
        ? item.category_raw
        : null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([category, items]) => ({
    category,
    items: items.slice().sort((a, b) => a.position - b.position),
  }));
}

/** «14 BYN» for whole prices, «14,50 BYN» otherwise; «—» when null. */
function formatPrice(byn: number | null): string {
  if (byn == null) return '—';
  if (byn % 1 === 0) return `${byn} BYN`;
  return `${byn.toFixed(2).replace('.', ',')} BYN`;
}
