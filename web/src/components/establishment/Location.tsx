/**
 * Location — Server Component. «Расположение» section (main column + the anchor
 * target; the sidebar carries the same MapPreview on desktop). Shows the map
 * preview (tap → in-page interactive-map overlay) when coordinates exist, plus a
 * secondary «Как добраться» link out to a Yandex Maps route; else a beige
 * address card.
 */

import { MapPin, Navigation } from 'lucide-react';

import { yandexRouteUrl } from '@/lib/establishment-helpers';

import { MapPreview } from './MapPreview';

export function Location({
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
  return (
    <div className='flex flex-col gap-3.5'>
      <h2 className='font-display text-[20px] font-semibold'>Расположение</h2>
      {latitude != null && longitude != null ? (
        <>
          <MapPreview
            latitude={latitude}
            longitude={longitude}
            address={address}
          />
          <a
            href={yandexRouteUrl(latitude, longitude)}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center justify-center gap-2 self-start rounded-[14px] bg-background px-l py-3 text-body-m font-semibold text-foreground transition-colors hover:bg-muted'
          >
            <Navigation className='size-4 text-brand' aria-hidden='true' />
            Как добраться
          </a>
        </>
      ) : (
        <div className='flex flex-col gap-s rounded-card bg-figma-bg-warm p-l'>
          <p className='flex items-start gap-s text-body-l text-foreground'>
            <MapPin
              className='mt-1 size-5 shrink-0 text-brand'
              aria-hidden='true'
            />
            <span>
              {address}, {city}
            </span>
          </p>
          <p className='text-body-s text-muted-foreground'>
            Координаты для карты не указаны
          </p>
        </div>
      )}
    </div>
  );
}
