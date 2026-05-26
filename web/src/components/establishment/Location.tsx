/**
 * Location — Server Component (Brief 4).
 *
 * Address + city + external link to Yandex Maps with marker at the
 * establishment's coordinates. No embedded interactive map in Brief 4
 * (deferred — bypasses map-provider decision).
 *
 * The Yandex link is `target='_blank' rel='noopener noreferrer'` so it opens
 * in a new tab without leaking referrer info.
 */

import { MapPin, ExternalLink } from 'lucide-react';

import { yandexMapUrl } from '@/lib/establishment-helpers';

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
  const fullAddress = `${address}, ${city}`;
  const hasCoordinates = latitude != null && longitude != null;
  const mapHref = hasCoordinates
    ? yandexMapUrl(latitude, longitude, fullAddress)
    : null;

  return (
    <div className='flex flex-col gap-m'>
      <h2 className='text-display-s font-display'>Расположение</h2>
      <div className='flex flex-col gap-s rounded-l border border-border bg-figma-bg-warm p-l'>
        <p className='flex items-start gap-s text-body-l text-foreground'>
          <MapPin
            className='mt-1 size-5 shrink-0 text-brand'
            aria-hidden='true'
          />
          <span>{fullAddress}</span>
        </p>
        {mapHref ? (
          <a
            href={mapHref}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex w-fit items-center gap-s rounded-s bg-brand px-m py-s text-body-m font-medium text-text-on-primary transition-opacity hover:opacity-90'
          >
            Открыть на Яндекс.Картах
            <ExternalLink className='size-4' aria-hidden='true' />
          </a>
        ) : (
          <p className='text-body-s text-muted-foreground'>
            Координаты для карты не указаны
          </p>
        )}
      </div>
    </div>
  );
}
