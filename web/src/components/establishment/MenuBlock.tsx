/**
 * MenuBlock — Server Component (design revision).
 *
 * Three menu surfaces, all inline:
 *   1. Text menu (OCR) — warm-beige card, grouped by category with a brand
 *      icon-tile header, items as «name …(dotted leader)… price» rows. A
 *      disclaimer chip flags the auto-extraction. JSON-LD emits CLEAN items only.
 *   2. Photo menu — 4-up grid (3:4) with a «+N» overlay on the last tile.
 *   3. PDF — «Скачать PDF» download button(s) in the photo-menu header.
 *
 * Empty-state: nothing rendered beyond the heading when there is no menu data.
 * Server Component throughout.
 */

import Image from 'next/image';
import { AlertCircle, ChefHat, FileText } from 'lucide-react';

import type { PublicMenuItem, PublicMedia } from '@/lib/api/types';

type MenuBlockProps = {
  menuItems: PublicMenuItem[];
  menuPhotos: PublicMedia[];
  pdfFallbacks: PublicMedia[];
  establishmentName: string;
};

export function MenuBlock({
  menuItems,
  menuPhotos,
  pdfFallbacks,
  establishmentName,
}: MenuBlockProps) {
  const hasItems = menuItems.length > 0;
  const hasPhotos = menuPhotos.length > 0;
  const hasPdfs = pdfFallbacks.length > 0;

  const groups = hasItems ? groupByCategory(menuItems) : [];
  const cleanItems = menuItems.filter((i) => i.quality_tier === 'clean');
  const jsonLd = buildMenuJsonLd(establishmentName, cleanItems);

  const shownPhotos = menuPhotos.slice(0, 4);
  const morePhotos = Math.max(0, menuPhotos.length - shownPhotos.length);

  return (
    <section className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='font-display text-[20px] font-semibold'>Меню</h2>
        {hasItems ? (
          <span className='inline-flex items-center gap-1.5 rounded-s bg-[#F7EFE6] px-2.5 py-1.5 text-body-s text-[#A07A52]'>
            <AlertCircle className='size-3.5 shrink-0' aria-hidden='true' />
            Меню извлечено автоматически — уточняйте у заведения
          </span>
        ) : null}
      </div>

      {hasItems ? (
        <div className='flex flex-col gap-6 rounded-card bg-figma-bg-warm p-l'>
          {groups.map((group) => (
            <div key={group.category ?? '__uncategorized__'}>
              {group.category ? (
                <h3 className='mb-2 flex items-center gap-2.5 font-display text-[15px] font-medium text-foreground'>
                  <span className='flex size-[26px] shrink-0 items-center justify-center rounded-s bg-background text-brand'>
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
                    <span className='whitespace-nowrap text-[15px] font-semibold text-foreground'>
                      {formatPrice(item.price_byn)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {hasPhotos || hasPdfs ? (
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <h3 className='text-body-m font-semibold text-muted-foreground'>
              {hasPhotos ? 'Фото меню' : 'Меню в PDF'}
            </h3>
            {hasPdfs ? (
              <div className='flex flex-wrap gap-2'>
                {pdfFallbacks.map((pdf) => (
                  <a
                    key={pdf.id}
                    href={pdf.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center gap-1.5 rounded-m border border-border bg-background px-3.5 py-2 text-body-s font-semibold text-foreground transition-colors hover:bg-muted'
                  >
                    <FileText className='size-4 text-brand' aria-hidden='true' />
                    Скачать PDF
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          {hasPhotos ? (
            <div className='grid grid-cols-4 gap-2.5'>
              {shownPhotos.map((photo, idx) => {
                const showMore = idx === shownPhotos.length - 1 && morePhotos > 0;
                return (
                  <a
                    key={photo.id}
                    href={photo.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='relative aspect-[3/4] overflow-hidden rounded-m bg-muted'
                  >
                    <Image
                      src={photo.preview_url ?? photo.url}
                      alt={photo.caption ?? `Меню — ${establishmentName}`}
                      fill
                      sizes='(max-width: 768px) 25vw, 160px'
                      className='object-cover'
                    />
                    {showMore ? (
                      <span className='absolute inset-0 flex items-center justify-center bg-black/50 text-body-m font-medium text-text-on-primary'>
                        +{morePhotos}
                      </span>
                    ) : null}
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasItems && !hasPhotos && !hasPdfs ? (
        <p className='text-body-m text-muted-foreground'>
          Меню пока не загружено.
        </p>
      ) : null}

      {cleanItems.length > 0 ? (
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
    </section>
  );
}

// -- internals --------------------------------------------------------------

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

/**
 * Build Schema.org/Menu JSON-LD from CLEAN items only.
 * Reference: https://schema.org/Menu
 */
function buildMenuJsonLd(
  establishmentName: string,
  cleanItems: PublicMenuItem[],
) {
  const sections = new Map<string, PublicMenuItem[]>();
  for (const item of cleanItems) {
    const key =
      item.category_raw && item.category_raw.length > 0
        ? item.category_raw
        : 'Меню';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(item);
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: `Меню — ${establishmentName}`,
    hasMenuSection: Array.from(sections.entries()).map(
      ([sectionName, items]) => ({
        '@type': 'MenuSection',
        name: sectionName,
        hasMenuItem: items.map((item) => ({
          '@type': 'MenuItem',
          name: item.item_name,
          ...(item.price_byn != null && {
            offers: {
              '@type': 'Offer',
              price: item.price_byn.toFixed(2),
              priceCurrency: 'BYN',
            },
          }),
        })),
      }),
    ),
  };
}
