/**
 * Gallery — Server Component.
 *
 * Hero mosaic (design revision):
 *   - Desktop (≥768px): a fixed-height (420px) CSS grid — one large photo left
 *     (1.7fr, spans both rows) + two stacked photos right (1fr). The bottom-right
 *     photo carries a «+N фотографий» overlay when there are more than 3.
 *   - Mobile (<768px): horizontal scroll-snap carousel (CSS-only, no JS).
 *
 * Photo filter: media[] with file_type='image' and type ∉ {'menu'} (menu photos
 * live in MenuBlock). Primary photo (is_primary / primary_image_url) goes first.
 *
 * Clicking a tile opens the in-page lightbox (client island) over the FULL
 * photo set — the «+N фотографий» overlay included. Tiles stay server-rendered;
 * only the provider/trigger shells are client components.
 *
 * Page weight (D1, 21.10.2026). Both trees are always in the HTML and one of
 * them is display:none, so:
 *   - every <Image> stays lazy (the default): a lazy image under display:none
 *     is never fetched, an eager one is — `priority`/`preload` on a tile would
 *     download the hidden tree's copy (on prod 18.10: +301 KB `w=1920` on a
 *     desktop, a duplicate `w=750` on a phone with DPR 3);
 *   - the first photo of each tree is preloaded by `preloadHero` with a media
 *     query matching that tree's breakpoint — `next/image` cannot put `media`
 *     on its own preload link — so only the visible copy is fetched early.
 *     Next dev warns «LCP image … add loading="eager"» for the lazy hero:
 *     expected — eager or `priority` brings the hidden copy back.
 * `sizes` (measured 21.10): the carousel slide is 85% of the viewport minus
 * the 2×24px page padding; the main tile is 689px once `max-w-6xl` caps the
 * page at 1152px. Both are never below the box there and at 768–1024px. NOT
 * covered: the main tile at 1025–1151px and the side tiles at 1025–1619px get
 * a `sizes` a little under their box — as before D1, left for a separate
 * decision since it adds bytes. Change the layout — change these.
 */

import Image, { getImageProps } from 'next/image';
import { preload } from 'react-dom';

import {
  LightboxProvider,
  LightboxTrigger,
  type LightboxPhoto,
} from '@/components/establishment/Lightbox';
import type { PublicMedia } from '@/lib/api/types';

type GalleryProps = {
  media: PublicMedia[];
  primaryImageUrl: string | null;
  establishmentName: string;
};

export function Gallery({
  media,
  primaryImageUrl,
  establishmentName,
}: GalleryProps) {
  const photos = sortPhotos(filterGalleryPhotos(media), primaryImageUrl);

  if (photos.length === 0) {
    return (
      <div className='flex aspect-[16/9] w-full items-center justify-center rounded-card bg-muted text-muted-foreground'>
        <span className='text-body-m'>Фотографий пока нет</span>
      </div>
    );
  }

  const [main, second, third] = photos;
  const remaining = Math.max(0, photos.length - 3);
  const lightboxPhotos: LightboxPhoto[] = photos.map((p) => ({
    id: p.id,
    url: p.url,
    previewUrl: p.preview_url ?? null,
    thumbnailUrl: p.thumbnail_url ?? null,
    caption: p.caption ?? null,
  }));

  preloadHero(main.preview_url ?? main.url, CAROUSEL_SIZES, PHONE_MEDIA);
  preloadHero(main.preview_url ?? main.url, MAIN_TILE_SIZES, DESKTOP_MEDIA);

  return (
    <LightboxProvider
      photos={lightboxPhotos}
      label={`Фотографии — ${establishmentName}`}
    >
      {/* Mobile: scroll-snap horizontal carousel */}
      <div
        className='-mx-l flex snap-x snap-mandatory gap-s overflow-x-auto px-l md:hidden'
        style={{ scrollbarWidth: 'none' }}
      >
        {photos.map((photo, idx) => (
          <LightboxTrigger
            key={photo.id}
            index={idx}
            aria-label={`Открыть фото ${idx + 1} из ${photos.length}`}
            className='relative aspect-[4/3] min-w-[85%] shrink-0 snap-center overflow-hidden rounded-card bg-muted'
          >
            <Image
              src={photo.preview_url ?? photo.url}
              alt={photo.caption ?? `${establishmentName} — фото ${idx + 1}`}
              fill
              sizes={CAROUSEL_SIZES}
              className='object-cover'
              fetchPriority={idx === 0 ? 'high' : undefined}
            />
          </LightboxTrigger>
        ))}
      </div>

      {/* Desktop: hero mosaic — 1 large left + 2 stacked right */}
      <div className='hidden h-[420px] grid-cols-[1.7fr_1fr] grid-rows-2 gap-[10px] md:grid'>
        <LightboxTrigger
          index={0}
          aria-label={`Открыть фото 1 из ${photos.length}`}
          className='relative col-start-1 row-span-2 overflow-hidden rounded-[20px_0_0_20px] bg-muted'
        >
          <Image
            src={main.preview_url ?? main.url}
            alt={main.caption ?? `${establishmentName} — главное фото`}
            fill
            sizes={MAIN_TILE_SIZES}
            className='object-cover'
            fetchPriority='high'
          />
        </LightboxTrigger>

        {second ? (
          <LightboxTrigger
            index={1}
            aria-label={`Открыть фото 2 из ${photos.length}`}
            className='relative col-start-2 row-start-1 overflow-hidden rounded-[0_20px_0_0] bg-muted'
          >
            <Image
              src={second.preview_url ?? second.url}
              alt={second.caption ?? `${establishmentName} — фото`}
              fill
              sizes='(max-width: 1024px) 40vw, 25vw'
              className='object-cover'
            />
          </LightboxTrigger>
        ) : (
          <div
            className='col-start-2 row-start-1 rounded-[0_20px_0_0] bg-muted'
            aria-hidden='true'
          />
        )}

        {third ? (
          <LightboxTrigger
            index={2}
            aria-label={
              remaining > 0
                ? `Открыть все ${photos.length} фотографий`
                : `Открыть фото 3 из ${photos.length}`
            }
            className='relative col-start-2 row-start-2 overflow-hidden rounded-[0_0_20px_0] bg-muted'
          >
            <Image
              src={third.preview_url ?? third.url}
              alt={third.caption ?? `${establishmentName} — фото`}
              fill
              sizes='(max-width: 1024px) 40vw, 25vw'
              className='object-cover'
            />
            {remaining > 0 ? (
              <span className='absolute inset-0 flex items-center justify-center bg-black/50 text-body-l font-medium text-text-on-primary'>
                +{remaining} фотографий
              </span>
            ) : null}
          </LightboxTrigger>
        ) : (
          <div
            className='col-start-2 row-start-2 rounded-[0_0_20px_0] bg-muted'
            aria-hidden='true'
          />
        )}
      </div>
    </LightboxProvider>
  );
}

// -- internals --------------------------------------------------------------

/** Tailwind `md:` (48rem) splits the two trees: carousel below, mosaic at/above. */
const PHONE_MEDIA = 'not all and (min-width: 48rem)';
const DESKTOP_MEDIA = '(min-width: 48rem)';

/** Carousel slide: `min-w-[85%]` of the viewport minus `px-l` on both sides. */
const CAROUSEL_SIZES = 'calc(85vw - 40px)';

/** Main mosaic tile: fixed 689px from 1152px up (`max-w-6xl`), else as before. */
const MAIN_TILE_SIZES = '(min-width: 1152px) 690px, (max-width: 1024px) 60vw, 45vw';

/**
 * Preload one tree's hero photo for the viewports where that tree is shown —
 * the same srcset/sizes `<Image fill sizes>` renders, so the browser picks the
 * same candidate for the link and for the (lazy) <img>, and the <img> takes
 * the preloaded response.
 */
function preloadHero(src: string, sizes: string, media: string) {
  const { props } = getImageProps({ src, alt: '', fill: true, sizes });
  preload(props.src, {
    as: 'image',
    imageSrcSet: props.srcSet,
    imageSizes: props.sizes,
    fetchPriority: 'high',
    media,
  });
}

/**
 * Filter media[] to gallery-eligible photos:
 *   - file_type === 'image' (excludes PDF menus)
 *   - type !== 'menu' (menu photos belong to MenuBlock, not gallery)
 *   - has a URL (defensive — backend should always emit, but guard anyway)
 */
function filterGalleryPhotos(media: PublicMedia[]): PublicMedia[] {
  return media.filter((m) => {
    if (m.file_type === 'pdf') return false;
    if (m.type === 'menu') return false;
    if (!m.url) return false;
    return true;
  });
}

/**
 * Sort photos so the primary one comes first.
 * Primary detection: is_primary flag OR url matches primary_image_url.
 */
function sortPhotos(
  photos: PublicMedia[],
  primaryUrl: string | null,
): PublicMedia[] {
  if (photos.length <= 1) return photos;
  const primaryIdx = photos.findIndex(
    (p) =>
      p.is_primary === true ||
      (primaryUrl != null &&
        (p.url === primaryUrl || p.thumbnail_url === primaryUrl)),
  );
  if (primaryIdx <= 0) return photos;
  const reordered = photos.slice();
  const [primary] = reordered.splice(primaryIdx, 1);
  reordered.unshift(primary);
  return reordered;
}
