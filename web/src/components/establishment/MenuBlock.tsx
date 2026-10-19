/**
 * MenuBlock — Server Component (design revision).
 *
 * Three menu surfaces, all inline:
 *   1. Text menu (OCR) — warm-beige card, grouped by category with a brand
 *      icon-tile header, items as «name …(dotted leader)… price» rows. A
 *      disclaimer chip flags the auto-extraction. JSON-LD emits CLEAN items only.
 *   2. Photo menu — 4-up grid (3:4) with a «+N» overlay on the last tile; a
 *      click opens the in-page lightbox over the FULL photo set (client island;
 *      tiles stay server-rendered).
 *   3. PDF — «Скачать PDF» download button(s) in the photo-menu header. PDFs
 *      keep the preview + download flow and never enter the photo lightbox.
 *
 * Empty-state: «Меню пока не загружено.» when there is no menu data. When the
 * page could not load the text menu (`menuItems` null — a failed fetch, not an
 * empty menu) it says neither that nor nothing: MenuLoadFailed loads the items
 * from the visitor's browser and drops the cached failed page (сверка находок
 * тестировщика с сайтом, 18.10, Ш8 — the reviews' fix of PR #81, for the menu).
 * Server Component throughout, except that island.
 */

import Image from 'next/image';
import { FileText } from 'lucide-react';

import {
  LightboxProvider,
  LightboxTrigger,
  type LightboxPhoto,
} from '@/components/establishment/Lightbox';
import {
  MenuAutoExtractedNote,
  MenuItemsList,
} from '@/components/establishment/MenuItemsList';
import { MenuLoadFailed } from '@/components/establishment/MenuLoadFailed';
import { JsonLdScript } from '@/components/JsonLdScript';
import type { PublicMenuItem, PublicMedia } from '@/lib/api/types';

type MenuBlockProps = {
  /** null — the page's fetch of the text menu failed (not: there is none). */
  menuItems: PublicMenuItem[] | null;
  menuPhotos: PublicMedia[];
  pdfFallbacks: PublicMedia[];
  establishmentName: string;
  /** For MenuLoadFailed: whose items to load, which cached page to drop. */
  slug?: string;
  detailPath?: string;
};

export function MenuBlock({
  menuItems,
  menuPhotos,
  pdfFallbacks,
  establishmentName,
  slug = '',
  detailPath = '',
}: MenuBlockProps) {
  const items = menuItems ?? [];
  const hasItems = items.length > 0;
  const hasPhotos = menuPhotos.length > 0;
  const hasPdfs = pdfFallbacks.length > 0;
  // Two identical «Скачать PDF» buttons are indistinguishable; number them
  // «Меню 1 / Меню 2 …» once there is more than one file. A single PDF keeps
  // the plain «Скачать PDF» label.
  const multiplePdfs = pdfFallbacks.length > 1;

  const cleanItems = items.filter((i) => i.quality_tier === 'clean');
  const jsonLd = buildMenuJsonLd(establishmentName, cleanItems);

  const shownPhotos = menuPhotos.slice(0, 4);
  const morePhotos = Math.max(0, menuPhotos.length - shownPhotos.length);

  return (
    <section className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='font-display text-[20px] font-semibold'>Меню</h2>
        {hasItems ? (
          <MenuAutoExtractedNote />
        ) : null}
      </div>

      {hasItems ? (
        <MenuItemsList menuItems={items} />
      ) : menuItems === null ? (
        <MenuLoadFailed
          slug={slug}
          detailPath={detailPath}
          hasOtherMenu={hasPhotos || hasPdfs}
        />
      ) : null}

      {hasPhotos || hasPdfs ? (
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <h3 className='text-body-m font-semibold text-muted-foreground'>
              {hasPhotos ? 'Фото меню' : 'Меню в PDF'}
            </h3>
            {hasPdfs ? (
              <div className='flex flex-wrap gap-2'>
                {pdfFallbacks.map((pdf, idx) => (
                  <a
                    key={pdf.id}
                    href={pdf.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label={
                      multiplePdfs
                        ? `Скачать меню ${idx + 1} (PDF)`
                        : undefined
                    }
                    className='inline-flex items-center gap-1.5 rounded-m border border-border bg-background px-3.5 py-2 text-body-s font-semibold text-foreground transition-colors hover:bg-muted'
                  >
                    <FileText className='size-4 text-brand' aria-hidden='true' />
                    {multiplePdfs ? `Меню ${idx + 1}` : 'Скачать PDF'}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          {hasPhotos ? (
            <LightboxProvider
              photos={menuPhotos.map(
                (p): LightboxPhoto => ({
                  id: p.id,
                  url: p.url,
                  previewUrl: p.preview_url ?? null,
                  thumbnailUrl: p.thumbnail_url ?? null,
                  caption: p.caption ?? null,
                }),
              )}
              label={`Фото меню — ${establishmentName}`}
            >
              <div className='grid grid-cols-4 gap-2.5'>
                {shownPhotos.map((photo, idx) => {
                  const showMore = idx === shownPhotos.length - 1 && morePhotos > 0;
                  return (
                    <LightboxTrigger
                      key={photo.id}
                      index={idx}
                      aria-label={
                        showMore
                          ? `Открыть все ${menuPhotos.length} фото меню`
                          : `Открыть фото меню ${idx + 1} из ${menuPhotos.length}`
                      }
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
                    </LightboxTrigger>
                  );
                })}
              </div>
            </LightboxProvider>
          ) : null}
        </div>
      ) : null}

      {menuItems !== null && !hasItems && !hasPhotos && !hasPdfs ? (
        <p className='text-body-m text-muted-foreground'>
          Меню пока не загружено.
        </p>
      ) : null}

      {/* Item names are OCR output from the partner's menu photo — the
          serializer in JsonLdScript keeps them from closing the tag. */}
      {cleanItems.length > 0 ? <JsonLdScript data={jsonLd} /> : null}
    </section>
  );
}

// -- internals --------------------------------------------------------------

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
