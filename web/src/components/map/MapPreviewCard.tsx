'use client';

import Image from 'next/image';

import type { PublicEstablishmentMapMarker } from '@/lib/api/types';
import { formatRating, ratingColorClass } from '@/lib/establishment-helpers';
import { normalizeCategory } from '@/lib/working-hours';

import { SmartLink } from '@/components/SmartLink';

/*
 * Map tap-to-preview card (Slice C) — the web mirror of the mobile map preview
 * (_buildPreviewContent). Compact card pinned to the bottom of the map: thumbnail,
 * name, rating, category, address, price; the whole card links to the detail page
 * ("Подробнее"). All data comes from the marker projection (Slice 0) — no extra
 * fetch, no view_count inflation. Dismiss via the ✕.
 *
 * Detail href mirrors EstablishmentCard: the establishment's own city/category
 * slug, falling back to the current map page's slugs when the projection is null
 * (category_slug is null for any establishment outside the slug canon).
 */
export function MapPreviewCard({
  marker,
  fallbackCitySlug,
  fallbackCategorySlug,
  onClose,
}: {
  marker: PublicEstablishmentMapMarker;
  fallbackCitySlug: string;
  fallbackCategorySlug: string;
  onClose: () => void;
}) {
  const citySlug = marker.city_slug ?? fallbackCitySlug;
  const categorySlug = marker.category_slug ?? fallbackCategorySlug;
  const href = `/${citySlug}/${categorySlug}/${marker.slug}`;
  const category = marker.categories[0]
    ? normalizeCategory(marker.categories[0])
    : null;

  // Bottom-left, narrow, lifted clear of the Yandex controls row that lines the
  // map's bottom edge (the "Открыть Яндекс Карты" button bottom-left + the
  // copyright bottom-right — a licence requirement to keep visible). Full-width
  // on mobile, capped on desktop.
  return (
    <div className="absolute bottom-16 left-3 z-10 w-[calc(100%-1.5rem)] max-w-[360px]">
      <div className="relative flex overflow-hidden rounded-card bg-figma-bg-warm shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
        <SmartLink href={href} className="flex min-w-0 flex-1">
          <div className="relative aspect-square w-28 shrink-0 bg-muted">
            {marker.primary_image_url ? (
              <Image
                src={marker.primary_image_url}
                alt={marker.name}
                fill
                // Match the rendered thumbnail box (w-28 = 112px) so next/image
                // serves a crisp variant on retina/scaled displays (a smaller
                // `sizes` makes it pick a too-small width that looks soft).
                sizes="112px"
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-caption-l text-muted-foreground">
                Нет фото
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 pr-9">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 font-display text-[16px] leading-tight text-foreground">
                {marker.name}
              </h3>
              {marker.average_rating != null && marker.review_count > 0 && (
                <div
                  className={`flex size-[30px] shrink-0 items-center justify-center rounded-s text-[14px] font-semibold text-text-on-primary ${ratingColorClass(
                    marker.average_rating,
                  )}`}
                >
                  {formatRating(marker.average_rating)}
                </div>
              )}
            </div>

            {category && (
              <p className="text-body-s text-foreground">
                {category.toLowerCase()}
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[12px] text-muted-foreground">
                {marker.address}
              </p>
              {marker.price_range && (
                <span className="shrink-0 text-[14px] font-semibold text-foreground">
                  {'₽'.repeat(marker.price_range.length)}
                </span>
              )}
            </div>

            <span className="text-caption-l font-medium text-brand">
              Подробнее →
            </span>
          </div>
        </SmartLink>

        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-white/90 text-[13px] text-foreground shadow"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
