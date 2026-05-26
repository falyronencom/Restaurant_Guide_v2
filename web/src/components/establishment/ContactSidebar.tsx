/**
 * ContactSidebar — Server Component (Brief 4).
 *
 * Booking-style sticky right sidebar (desktop only). Three blocks:
 *   1. Rating-summary — large rating square + verbal label + review count
 *   2. Contact card — phone-as-button (primary CTA in our restaurant context),
 *      website link, working hours summary («Сегодня: 10:00–22:00»)
 *   3. Map preview — address + button «Открыть на Яндекс.Картах»
 *
 * On mobile the sidebar is hidden entirely (sections render in main flow
 * via parent page layout); on desktop it sticks via CSS `position: sticky`
 * applied by parent <aside> — no JS for stickiness.
 *
 * Server Component throughout. OpenStatusBadge (Brief 3 client island) is
 * reused inline for live status. Sample-review preview block from Booking
 * (Natallia/Беларусь quote) — skipped: the same content shows in the main
 * reviews section below, no need to duplicate.
 */

import { Phone, Globe, MapPin } from 'lucide-react';

import type { PublicEstablishmentDetail } from '@/lib/api/types';
import { OpenStatusBadge } from '@/components/catalog/OpenStatusBadge';
import {
  formatRating,
  ratingLabel,
  pluralizeReviews,
  yandexMapUrl,
  normalizeWorkingHours,
} from '@/lib/establishment-helpers';

export function ContactSidebar({
  establishment,
}: {
  establishment: PublicEstablishmentDetail;
}) {
  const label = ratingLabel(establishment.average_rating);
  const todayHours = formatTodayHours(establishment.working_hours);

  const mapHref =
    establishment.latitude != null && establishment.longitude != null
      ? yandexMapUrl(
          establishment.latitude,
          establishment.longitude,
          `${establishment.address}, ${establishment.city}`,
        )
      : null;

  return (
    <div className='flex flex-col gap-m'>
      {/* Rating summary */}
      {establishment.average_rating != null ? (
        <div className='flex flex-col gap-s rounded-l border border-border bg-background p-m'>
          <div className='flex items-center gap-s'>
            <span className='inline-flex size-12 items-center justify-center rounded-s bg-success-status text-display-s font-medium text-text-on-primary'>
              {formatRating(establishment.average_rating)}
            </span>
            <div className='flex flex-col'>
              {label ? <span className='text-body-l text-foreground'>{label}</span> : null}
              <span className='text-body-s text-muted-foreground'>
                {pluralizeReviews(establishment.review_count)}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Contact card */}
      <div className='flex flex-col gap-s rounded-l border border-border bg-background p-m'>
        {establishment.phone ? (
          <a
            href={`tel:${establishment.phone.replace(/\s/g, '')}`}
            className='inline-flex items-center justify-center gap-s rounded-s bg-brand px-l py-m text-headline-s font-medium text-text-on-primary transition-opacity hover:opacity-90'
          >
            <Phone className='size-5' aria-hidden='true' />
            {establishment.phone}
          </a>
        ) : null}

        {establishment.website ? (
          <a
            href={ensureUrlScheme(establishment.website)}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center justify-center gap-s rounded-s border border-border bg-background px-l py-s text-body-m text-foreground transition-colors hover:bg-muted'
          >
            <Globe className='size-4' aria-hidden='true' />
            Перейти на сайт
          </a>
        ) : null}

        <div className='flex items-center justify-between gap-s pt-s'>
          <span className='text-body-s text-muted-foreground'>Статус:</span>
          <OpenStatusBadge
            workingHours={establishment.working_hours}
            status={establishment.status}
          />
        </div>

        {todayHours ? (
          <p className='text-body-s text-muted-foreground'>
            Сегодня: <span className='font-medium text-foreground'>{todayHours}</span>
          </p>
        ) : null}

        {establishment.price_range ? (
          <p className='text-body-s text-muted-foreground'>
            Средний чек:{' '}
            <span className='font-medium text-foreground'>{establishment.price_range}</span>
          </p>
        ) : null}
      </div>

      {/* Map preview */}
      {mapHref ? (
        <a
          href={mapHref}
          target='_blank'
          rel='noopener noreferrer'
          className='flex flex-col gap-s rounded-l border border-border bg-figma-bg-warm p-m transition-colors hover:bg-muted'
        >
          <span className='inline-flex items-center gap-s text-body-s text-muted-foreground'>
            <MapPin className='size-4 text-brand' aria-hidden='true' />
            Расположение
          </span>
          <span className='text-body-m text-foreground'>
            {establishment.address}
          </span>
          <span className='text-caption-l text-brand'>
            Открыть на Яндекс.Картах →
          </span>
        </a>
      ) : null}
    </div>
  );
}

// -- internals --------------------------------------------------------------

function formatTodayHours(rawWorkingHours: unknown): string | null {
  const parsed = normalizeWorkingHours(rawWorkingHours);
  if (!parsed) return null;
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const todayIdx = (new Date().getDay() + 6) % 7;
  const today = parsed[dayKeys[todayIdx]];
  if (!today || today.is_open === false) return 'Выходной';
  if (!today.open || !today.close) return null;
  return `${today.open} – ${today.close}`;
}

function ensureUrlScheme(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
