/**
 * PromotionBanner — Server Component (Brief 4).
 *
 * Renders active promotions as a static display-only block. Each promotion =
 * compact card with optional image, title, description, valid-until date.
 * Per directive: NO interactive carousel / bottom-sheet (mobile uses modal;
 * web shows them inline).
 *
 * Backend `publicService.assembleEstablishmentDetail` calls
 * `PromotionModel.getPromotionsByEstablishment(id, false)` which already
 * filters to active (non-expired, non-hidden) entries — no client-side filter
 * needed here.
 */

import Image from 'next/image';
import { Sparkles, CalendarClock } from 'lucide-react';

import type { PublicPromotion } from '@/lib/api/types';
import { formatDateRu } from '@/lib/establishment-helpers';

export function PromotionBanner({
  promotions,
}: {
  promotions: PublicPromotion[];
}) {
  if (promotions.length === 0) return null;

  return (
    <div className='flex flex-col gap-m'>
      <h2 className='inline-flex items-center gap-s text-display-s font-display'>
        <Sparkles className='size-6 text-brand' aria-hidden='true' />
        {promotions.length === 1 ? 'Акция' : 'Акции'}
      </h2>
      <ul className='flex flex-col gap-m'>
        {promotions.map((promo) => (
          <li
            key={promo.id}
            className='flex flex-col gap-m rounded-[var(--radius-l)] border border-brand/30 bg-brand/5 p-m sm:flex-row'
          >
            {promo.preview_url || promo.image_url ? (
              <div className='relative aspect-[16/9] w-full overflow-hidden rounded-m bg-muted sm:aspect-[4/3] sm:w-48 sm:shrink-0'>
                <Image
                  src={(promo.preview_url ?? promo.image_url) as string}
                  alt={promo.title}
                  fill
                  sizes='(max-width: 640px) 100vw, 192px'
                  className='object-cover'
                />
              </div>
            ) : null}
            <div className='flex flex-1 flex-col gap-s'>
              <h3 className='text-headline-m font-display text-foreground'>
                {promo.title}
              </h3>
              {promo.description ? (
                <p className='text-body-m text-foreground'>
                  {promo.description}
                </p>
              ) : null}
              {promo.valid_until ? (
                <p className='inline-flex items-center gap-s text-body-s text-muted-foreground'>
                  <CalendarClock className='size-4' aria-hidden='true' />
                  до {formatDateRu(promo.valid_until)}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
