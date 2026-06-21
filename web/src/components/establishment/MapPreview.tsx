/**
 * MapPreview — Server Component. Compact location card linking to Yandex Maps.
 *
 * Shared by the main-column Location section and the contact sidebar. A real
 * static Yandex map is deferred until the Static API key is provisioned
 * (Coordinator decision) — for now this is a styled placeholder: a brand pin on
 * a neutral field with a bottom gradient carrying the address + open-in-maps
 * link. Swapping `bg-muted` for the static-map <Image> is the only change when
 * the key lands. Returns null when coordinates are absent.
 */

import { MapPin } from 'lucide-react';

import { yandexMapUrl } from '@/lib/establishment-helpers';

export function MapPreview({
  latitude,
  longitude,
  address,
  city,
}: {
  latitude: number | null;
  longitude: number | null;
  address: string;
  city: string;
}) {
  if (latitude == null || longitude == null) return null;
  const href = yandexMapUrl(latitude, longitude, `${address}, ${city}`);

  return (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      className='relative block h-[180px] overflow-hidden rounded-card bg-muted'
    >
      <div
        className='absolute inset-0 bg-gradient-to-t from-black/60 to-transparent'
        aria-hidden='true'
      />
      <MapPin
        className='absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-full fill-brand text-brand'
        aria-hidden='true'
      />
      <div className='absolute inset-x-0 bottom-0 p-4'>
        <div className='text-body-m font-semibold text-white'>{address}</div>
        <div className='text-caption-l text-white/85'>
          Открыть на Яндекс.Картах →
        </div>
      </div>
    </a>
  );
}
