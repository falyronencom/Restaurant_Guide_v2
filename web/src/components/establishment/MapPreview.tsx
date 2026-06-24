/**
 * MapPreview — Server Component. Compact location card that opens our OWN
 * interactive map as an in-page overlay (D-2A), centred on this establishment
 * with its pin pre-selected — keeping the user on the establishment page (its
 * URL is preserved) instead of bouncing out to external Yandex Maps or away to
 * the catalog. The click→overlay behaviour lives in the MapPreviewTrigger client
 * wrapper; the page-level EstablishmentMapOverlay renders the actual map.
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

import { yandexStaticMapUrl } from '@/lib/establishment-helpers';

import { MapBrandPin } from './MapBrandPin';
import { MapPreviewTrigger } from './MapPreviewTrigger';

export function MapPreview({
  latitude,
  longitude,
  address,
}: {
  latitude: number | null;
  longitude: number | null;
  address: string;
}) {
  if (latitude == null || longitude == null) return null;
  const mapSrc = yandexStaticMapUrl(
    latitude,
    longitude,
    process.env.YANDEX_MAPS_API_KEY,
  );

  return (
    <MapPreviewTrigger>
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
    </MapPreviewTrigger>
  );
}
