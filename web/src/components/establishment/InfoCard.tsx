/**
 * InfoCard — establishment overview facts (design revision).
 *
 * A warm-beige card with a 2×2 facts grid: Адрес, Средний чек, Сегодня, Телефон.
 * Each fact is a white icon tile (brand glyph, or the price symbol) + label +
 * value. The «Сегодня» fact is an expandable native <details>: its summary is
 * today's hours, and it opens to the full grouped week (no JS). The rating /
 * reviews / open-status live in the page title block.
 *
 * The phone is a link: on a phone this card is the only place with the number
 * (ContactSidebar and its button are desktop-only), and the tap is what the
 * partner's «Звонки» counts.
 *
 * Server Component. The «Сегодня» fact is a client island (HoursFact): which day
 * is today is the reader's, not the server's — its clock is UTC and the page is
 * kept up to an hour (ISR).
 */

import { MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PublicEstablishmentDetail } from '@/lib/api/types';
import { normalizeWorkingHours } from '@/lib/establishment-helpers';
// Price tier → check description: one source with the filters and the wizard.
import { PRICE_DESCRIPTION } from '@/lib/price-range';

import { HoursFact } from './HoursFact';
import { PhoneCallLink } from './PhoneCallLink';

export function InfoCard({
  establishment,
}: {
  establishment: PublicEstablishmentDetail;
}) {
  const priceRange = establishment.price_range;
  const week = normalizeWorkingHours(establishment.working_hours);

  return (
    <div className='rounded-card bg-figma-bg-warm p-l'>
      <div className='grid grid-cols-1 items-start gap-4 sm:grid-cols-2'>
        <Fact
          tile={<MapPin className='size-5' aria-hidden='true' />}
          label='Адрес'
          value={`${establishment.address}, ${establishment.city}`}
        />
        {priceRange ? (
          <Fact
            tile={
              <span className='text-[18px] leading-none font-bold'>
                {'$'.repeat(priceRange.length)}
              </span>
            }
            label='Средний чек'
            value={PRICE_DESCRIPTION[priceRange] ?? priceRange}
          />
        ) : null}
        {week ? <HoursFact week={week} /> : null}
        {establishment.phone ? (
          <Fact
            tile={<Phone className='size-5' aria-hidden='true' />}
            label='Телефон'
            value={
              <PhoneCallLink
                establishmentId={establishment.id}
                phone={establishment.phone}
                className='underline decoration-brand underline-offset-2'
              >
                {establishment.phone}
              </PhoneCallLink>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

// -- internals --------------------------------------------------------------

function Fact({
  tile,
  label,
  value,
}: {
  tile: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className='flex items-center gap-3'>
      <span className='flex size-10 shrink-0 items-center justify-center rounded-m bg-background text-brand'>
        {tile}
      </span>
      <div className='min-w-0'>
        <div className='text-body-s text-muted-foreground'>{label}</div>
        <div className='truncate text-[15px] font-semibold text-foreground'>
          {value}
        </div>
      </div>
    </div>
  );
}

