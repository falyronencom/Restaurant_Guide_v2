/**
 * MapPreview — Server Component. Compact location card that deep-links into our
 * OWN interactive map (Slice D part 1), centred on this establishment with its
 * pin pre-selected — keeping the user in our funnel to explore nearby places,
 * instead of bouncing out to external Yandex Maps.
 *
 * Shared by the main-column Location section and the contact sidebar. Renders a
 * real Yandex Static API map when YANDEX_MAPS_API_KEY is set (read server-side
 * here, baked into the image URL) with the brand pin + address overlaid; falls
 * back to a styled bg-muted placeholder when the key is absent (local dev, or a
 * deploy without the env var). Returns null when coordinates are absent.
 *
 * The static map is a plain <img>, not next/image, on purpose: the key is
 * HTTP-Referer-locked to our domains in the Yandex cabinet, so the request must
 * come from the browser (carrying the page Referer). next/image would proxy it
 * server-side and trip the lock. See yandexStaticMapUrl.
 */

import Link from 'next/link';

import { yandexStaticMapUrl } from '@/lib/establishment-helpers';

import { MapBrandPin } from './MapBrandPin';

export function MapPreview({
  latitude,
  longitude,
  address,
  citySlug,
  slug,
}: {
  latitude: number | null;
  longitude: number | null;
  address: string;
  /** URL slug of the city (authoritative — establishment.city_slug may be null). */
  citySlug: string;
  /** Establishment slug — matched against the map marker to pre-select its pin. */
  slug: string;
}) {
  if (latitude == null || longitude == null) return null;
  // Deep-link into our interactive map: ?view=map opens it, focus+coords centre
  // it on this establishment and auto-select its pin (see MapView Slice D part 1).
  const href = `/${citySlug}?view=map&focus=${encodeURIComponent(
    slug,
  )}&flat=${latitude}&flng=${longitude}`;
  const mapSrc = yandexStaticMapUrl(
    latitude,
    longitude,
    process.env.YANDEX_MAPS_API_KEY,
  );

  return (
    <Link
      href={href}
      className='relative block h-[180px] overflow-hidden rounded-card bg-muted'
    >
      {mapSrc && (
        // eslint-disable-next-line @next/next/no-img-element -- external Referer-locked static map; must load client-side, so not next/image (see doc comment)
        <img
          src={mapSrc}
          alt=''
          aria-hidden='true'
          className='absolute inset-0 size-full object-cover'
          loading='lazy'
          decoding='async'
        />
      )}
      <div
        className='absolute inset-0 bg-gradient-to-t from-black/60 to-transparent'
        aria-hidden='true'
      />
      <MapBrandPin className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full' />
      <div className='absolute inset-x-0 bottom-0 p-4'>
        <div className='text-body-m font-semibold text-white'>{address}</div>
        <div className='text-caption-l text-white/85'>Открыть на карте →</div>
      </div>
    </Link>
  );
}
