/**
 * Gallery — Server Component (Brief 4).
 *
 * Booking-style photo composition:
 *   - Desktop (≥768px): 1 крупное фото слева (≈60% ширины) + 2 средних
 *     stacked справа. Если фото ≤3 — занимают полную сетку.
 *   - Mobile (<768px): horizontal scroll-snap carousel (CSS-only, без JS) —
 *     одна фотография на viewport, swipe для листания.
 *   - При 4+ фото показываем thumbnail-row под основной композицией с
 *     overlay '+N фотографий' на последнем thumbnail (clickable as link to
 *     fullscreen carousel — deferred lightbox, для Brief 4 каждый thumbnail
 *     открывает оригинал в новой вкладке).
 *
 * Photo filter: takes media[] с file_type='image' и type ∉ {'menu'}. Menu
 * photos обрабатываются отдельно в MenuBlock. Primary photo (is_primary=true
 * or matches primary_image_url) ставится первой.
 *
 * No client island for Brief 4 (lightbox deferred): clicks open photo in new
 * tab via native anchor. Future Brief может добавить fullscreen lightbox с
 * carousel controls; здесь — статическая server-rendered композиция.
 */

import Image from 'next/image';

import type { PublicMedia } from '@/lib/api/types';

type GalleryProps = {
  media: PublicMedia[];
  primaryImageUrl: string | null;
  establishmentName: string;
};

export function Gallery({ media, primaryImageUrl, establishmentName }: GalleryProps) {
  const photos = sortPhotos(filterGalleryPhotos(media), primaryImageUrl);

  if (photos.length === 0) {
    return (
      <div className='flex aspect-[16/9] w-full items-center justify-center rounded-l bg-muted text-muted-foreground'>
        <span className='text-body-m'>Фотографий пока нет</span>
      </div>
    );
  }

  const [main, ...rest] = photos;
  const sideTwo = rest.slice(0, 2);
  const thumbnails = rest.slice(2, 6);
  const remainingCount = Math.max(0, photos.length - 1 - sideTwo.length - thumbnails.length);

  return (
    <div className='flex flex-col gap-s'>
      {/* Mobile: scroll-snap horizontal carousel */}
      <div
        className='-mx-l flex snap-x snap-mandatory overflow-x-auto px-l md:hidden'
        // Hide scrollbar visually — pure CSS, no JS
        style={{ scrollbarWidth: 'none' }}
      >
        {photos.map((photo, idx) => (
          <a
            key={photo.id}
            href={photo.url}
            target='_blank'
            rel='noopener noreferrer'
            className='relative mr-s aspect-[4/3] min-w-[85%] snap-center overflow-hidden rounded-l bg-muted last:mr-0'
          >
            <Image
              src={photo.preview_url ?? photo.url}
              alt={photo.caption ?? `${establishmentName} — фото ${idx + 1}`}
              fill
              sizes='85vw'
              className='object-cover'
              priority={idx === 0}
            />
          </a>
        ))}
      </div>

      {/* Desktop: 1+2 main composition */}
      <div className='hidden gap-s md:grid md:grid-cols-[1.6fr_1fr] md:grid-rows-2'>
        {/* Main photo — left column, full height (spans 2 rows) */}
        <a
          href={main.url}
          target='_blank'
          rel='noopener noreferrer'
          className='relative col-start-1 row-span-2 aspect-[4/3] overflow-hidden rounded-l bg-muted md:aspect-auto'
        >
          <Image
            src={main.preview_url ?? main.url}
            alt={main.caption ?? `${establishmentName} — главное фото`}
            fill
            sizes='(max-width: 1024px) 60vw, 45vw'
            className='object-cover'
            priority
          />
        </a>
        {/* Right column — up to 2 side photos */}
        {sideTwo[0] ? (
          <a
            href={sideTwo[0].url}
            target='_blank'
            rel='noopener noreferrer'
            className='relative col-start-2 row-start-1 overflow-hidden rounded-l bg-muted'
          >
            <Image
              src={sideTwo[0].preview_url ?? sideTwo[0].url}
              alt={sideTwo[0].caption ?? `${establishmentName} — фото`}
              fill
              sizes='(max-width: 1024px) 40vw, 25vw'
              className='object-cover'
            />
          </a>
        ) : (
          <div className='col-start-2 row-start-1 rounded-l bg-muted' aria-hidden='true' />
        )}
        {sideTwo[1] ? (
          <a
            href={sideTwo[1].url}
            target='_blank'
            rel='noopener noreferrer'
            className='relative col-start-2 row-start-2 overflow-hidden rounded-l bg-muted'
          >
            <Image
              src={sideTwo[1].preview_url ?? sideTwo[1].url}
              alt={sideTwo[1].caption ?? `${establishmentName} — фото`}
              fill
              sizes='(max-width: 1024px) 40vw, 25vw'
              className='object-cover'
            />
          </a>
        ) : (
          <div className='col-start-2 row-start-2 rounded-l bg-muted' aria-hidden='true' />
        )}
      </div>

      {/* Desktop: thumbnail row (4 thumbnails max, last with +N overlay) */}
      {thumbnails.length > 0 ? (
        <div className='hidden grid-cols-4 gap-s md:grid'>
          {thumbnails.map((thumb, idx) => {
            const isLast = idx === thumbnails.length - 1;
            const showOverlay = isLast && remainingCount > 0;
            return (
              <a
                key={thumb.id}
                href={thumb.url}
                target='_blank'
                rel='noopener noreferrer'
                className='relative aspect-[4/3] overflow-hidden rounded-m bg-muted'
              >
                <Image
                  src={thumb.thumbnail_url ?? thumb.preview_url ?? thumb.url}
                  alt={thumb.caption ?? `${establishmentName} — фото ${idx + 4}`}
                  fill
                  sizes='(max-width: 1024px) 20vw, 12vw'
                  className='object-cover'
                />
                {showOverlay ? (
                  <span className='absolute inset-0 flex items-center justify-center bg-black/55 text-body-l font-medium text-text-on-primary'>
                    +{remainingCount} фотографий
                  </span>
                ) : null}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// -- internals --------------------------------------------------------------

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
function sortPhotos(photos: PublicMedia[], primaryUrl: string | null): PublicMedia[] {
  if (photos.length <= 1) return photos;
  const primaryIdx = photos.findIndex(
    (p) =>
      p.is_primary === true ||
      (primaryUrl != null && (p.url === primaryUrl || p.thumbnail_url === primaryUrl)),
  );
  if (primaryIdx <= 0) return photos;
  const reordered = photos.slice();
  const [primary] = reordered.splice(primaryIdx, 1);
  reordered.unshift(primary);
  return reordered;
}
