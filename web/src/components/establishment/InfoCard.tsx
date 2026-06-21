/**
 * InfoCard — establishment overview facts (design revision).
 *
 * A warm-beige card with a 2×2 facts grid: Адрес, Средний чек, Сегодня (today's
 * hours), Телефон. Each fact is a white icon tile (brand glyph, or the price
 * symbol) + label + value. The rating / reviews / open-status moved to the page
 * title block; the full weekly hours table was replaced by «Сегодня».
 *
 * Server Component. `new Date()` for «Сегодня» renders at ISR (re)generation —
 * the day can be up to a revalidate-window stale around midnight, the same
 * tradeoff the previous weekly table accepted.
 */

import { Clock, MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PublicEstablishmentDetail } from '@/lib/api/types';
import { normalizeWorkingHours } from '@/lib/establishment-helpers';

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

// Price tier → check description (data canon = $/$$/$$$, mirrors facets labels).
const PRICE_DESCRIPTION: Record<string, string> = {
  $: 'до 20 руб',
  $$: 'до 50 руб',
  $$$: 'более 50 руб',
};

export function InfoCard({
  establishment,
}: {
  establishment: PublicEstablishmentDetail;
}) {
  const todayHours = formatTodayHours(establishment.working_hours);
  const priceRange = establishment.price_range;

  return (
    <div className='rounded-card bg-figma-bg-warm p-l'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <Fact
          tile={<MapPin className='size-5' aria-hidden='true' />}
          label='Адрес'
          value={`${establishment.address}, ${establishment.city}`}
        />
        {priceRange ? (
          <Fact
            tile={
              <span className='text-[18px] leading-none font-bold'>
                {'₽'.repeat(priceRange.length)}
              </span>
            }
            label='Средний чек'
            value={PRICE_DESCRIPTION[priceRange] ?? priceRange}
          />
        ) : null}
        {todayHours ? (
          <Fact
            tile={<Clock className='size-5' aria-hidden='true' />}
            label='Сегодня'
            value={todayHours}
          />
        ) : null}
        {establishment.phone ? (
          <Fact
            tile={<Phone className='size-5' aria-hidden='true' />}
            label='Телефон'
            value={establishment.phone}
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
  value: string;
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

/** Today's hours — «17:00 – 02:00» / «Выходной», or null when unknown. */
function formatTodayHours(workingHours: unknown): string | null {
  const parsed = normalizeWorkingHours(workingHours);
  if (!parsed) return null;
  const todayIdx = (new Date().getDay() + 6) % 7; // Sun=0 → idx 6, Mon=1 → idx 0
  const today = parsed[DAY_KEYS[todayIdx]];
  if (today == null || today.is_open === false) return 'Выходной';
  if (!today.open || !today.close) return 'Выходной';
  return `${today.open} – ${today.close}`;
}
