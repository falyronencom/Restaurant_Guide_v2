/**
 * Location — Server Component. «Расположение» section (main column + the anchor
 * target; the sidebar carries the same MapPreview on desktop). Shows the map
 * preview when coordinates exist, else a beige address card.
 */

import { MapPin } from 'lucide-react';

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
  const hasCoordinates = latitude != null && longitude != null;

  return (
    <div className='flex flex-col gap-3.5'>
      <h2 className='font-display text-[20px] font-semibold'>Расположение</h2>
      {hasCoordinates ? (
        <MapPreview
          latitude={latitude}
          longitude={longitude}
          address={address}
          city={city}
        />
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
