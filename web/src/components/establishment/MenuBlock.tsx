/**
 * MenuBlock — Server Component (Brief 4 / CAT-C-2.7 augmentation).
 *
 * Renders parsed menu items with quality-aware presentation:
 *   - Items grouped by category_raw (when available)
 *   - 'needs_caution' tier → small "проверить" indicator inline (visual only,
 *     не блокирует отображение)
 *   - 'clean' items → rendered as plain rows
 *   - Platform-level disclaimer at the top of the block:
 *     «Меню извлечено автоматически, может содержать неточности»
 *   - JSON-LD Schema.org/Menu emitted as <script type='application/ld+json'>
 *     INCLUDING ONLY 'clean' items (per directive: не транслируем
 *     needs_caution в structured data — иначе search engines подхватят
 *     потенциально неверные цены/названия)
 *   - Empty-state: when menu_items.length === 0, fallback to PDF menus
 *     extracted from establishment.media[] where file_type='pdf' and
 *     type='menu'. Each PDF rendered as a download/open link.
 *
 * No client interactivity required — Server Component throughout.
 */

import { FileText, AlertCircle, ChefHat } from 'lucide-react';

import type { PublicMenuItem, PublicMedia } from '@/lib/api/types';

type MenuBlockProps = {
  menuItems: PublicMenuItem[];
  pdfFallbacks: PublicMedia[];
  establishmentName: string;
};

export function MenuBlock({
  menuItems,
  pdfFallbacks,
  establishmentName,
}: MenuBlockProps) {
  const hasItems = menuItems.length > 0;
  const hasPdfs = pdfFallbacks.length > 0;

  // Empty-state: no parsed items AND no PDF — section renders nothing
  if (!hasItems && !hasPdfs) {
    return (
      <div className='flex flex-col gap-m'>
        <h2 className='text-display-s font-display'>Меню</h2>
        <p className='text-body-m text-muted-foreground'>
          Меню пока не загружено.
        </p>
      </div>
    );
  }

  // Empty-state with PDF fallback
  if (!hasItems && hasPdfs) {
    return (
      <div className='flex flex-col gap-m'>
        <h2 className='text-display-s font-display'>Меню</h2>
        <p className='text-body-s text-muted-foreground'>
          Меню заведения представлено в виде PDF-документа.
        </p>
        <PdfFallbackList pdfs={pdfFallbacks} establishmentName={establishmentName} />
      </div>
    );
  }

  // Group items by category_raw
  const groups = groupByCategory(menuItems);

  // JSON-LD: only clean items
  const cleanItems = menuItems.filter((i) => i.quality_tier === 'clean');
  const jsonLd = buildMenuJsonLd(establishmentName, cleanItems);

  return (
    <div className='flex flex-col gap-m'>
      <h2 className='text-display-s font-display'>Меню</h2>

      {/* Platform-level disclaimer — applies to whole block, not per-item */}
      <p className='inline-flex items-start gap-s rounded-m bg-muted/60 px-m py-s text-body-s text-muted-foreground'>
        <AlertCircle
          className='mt-0.5 size-4 shrink-0 text-figma-text-grey'
          aria-hidden='true'
        />
        <span>
          Меню извлечено автоматически, может содержать неточности.
          Уточняйте актуальные позиции и цены у заведения.
        </span>
      </p>

      <div className='flex flex-col gap-l'>
        {groups.map((group) => (
          <div key={group.category ?? '__uncategorized__'} className='flex flex-col gap-s'>
            {group.category ? (
              <h3 className='inline-flex items-center gap-s text-headline-m font-display text-foreground'>
                <ChefHat className='size-5 text-brand' aria-hidden='true' />
                {group.category}
              </h3>
            ) : null}
            <ul className='divide-y divide-border'>
              {group.items.map((item) => (
                <li key={item.id} className='flex items-start justify-between gap-m py-s'>
                  <div className='flex flex-1 flex-col gap-1'>
                    <span className='inline-flex flex-wrap items-center gap-s text-body-l text-foreground'>
                      {item.item_name}
                      {item.quality_tier === 'needs_caution' ? (
                        <span
                          // Inline indicator — small, low-emphasis,
                          // не отвлекает от чтения; tooltip via title attr
                          // (native — no JS).
                          title='Эта позиция требует уточнения у заведения'
                          className='inline-flex items-center gap-1 rounded-xs bg-figma-bg-warm px-1.5 py-0.5 text-caption-s font-medium text-figma-text-dark'
                        >
                          <AlertCircle className='size-3' aria-hidden='true' />
                          уточнить
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <span className='whitespace-nowrap text-body-l font-medium text-foreground'>
                    {formatPrice(item.price_byn)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {hasPdfs ? (
        <div className='flex flex-col gap-s pt-m'>
          <p className='text-body-s text-muted-foreground'>
            Также доступно меню в PDF:
          </p>
          <PdfFallbackList pdfs={pdfFallbacks} establishmentName={establishmentName} />
        </div>
      ) : null}

      {/* JSON-LD Schema.org/Menu — clean items only */}
      {cleanItems.length > 0 ? (
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
    </div>
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
    const key = item.category_raw && item.category_raw.length > 0 ? item.category_raw : null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  // Preserve insertion order; sort items within each group by position
  return Array.from(map.entries()).map(([category, items]) => ({
    category,
    items: items.slice().sort((a, b) => a.position - b.position),
  }));
}

function formatPrice(byn: number | null): string {
  if (byn == null) return '—';
  // Russian-locale: запятая как разделитель, currency suffix BYN.
  return `${byn.toFixed(2).replace('.', ',')} BYN`;
}

/**
 * Build Schema.org/Menu JSON-LD. Brief 4 emits a minimal valid shape —
 * search engines parse what's there gracefully.
 *
 * Reference: https://schema.org/Menu
 */
function buildMenuJsonLd(establishmentName: string, cleanItems: PublicMenuItem[]) {
  // Group clean items by category for hasMenuSection
  const sections = new Map<string, PublicMenuItem[]>();
  for (const item of cleanItems) {
    const key = item.category_raw && item.category_raw.length > 0 ? item.category_raw : 'Меню';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(item);
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: `Меню — ${establishmentName}`,
    hasMenuSection: Array.from(sections.entries()).map(([sectionName, items]) => ({
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
    })),
  };
}

function PdfFallbackList({
  pdfs,
  establishmentName,
}: {
  pdfs: PublicMedia[];
  establishmentName: string;
}) {
  const sorted = pdfs.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return (
    <ul className='flex flex-col gap-s'>
      {sorted.map((pdf) => (
        <li key={pdf.id}>
          <a
            href={pdf.url}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-s rounded-m border border-border bg-background px-m py-s text-body-m text-foreground transition-colors hover:bg-muted'
          >
            <FileText className='size-5 text-brand' aria-hidden='true' />
            <span>
              {pdf.caption && pdf.caption.length > 0
                ? pdf.caption
                : `Меню — ${establishmentName} (PDF)`}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
