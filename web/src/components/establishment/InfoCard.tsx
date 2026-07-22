/**
 * InfoCard — establishment overview facts (design revision).
 *
 * A warm-beige card with a 2×2 facts grid: Адрес, Средний чек, Сегодня, Телефон.
 * Each fact is a white icon tile (brand glyph, or the price symbol) + label +
 * value. The «Сегодня» fact is an expandable native <details>: its summary is
 * today's hours, and it opens to the full grouped week (no JS). The rating /
 * reviews / open-status live in the page title block.
 *
 * Server Component. `new Date()` for «Сегодня» renders at ISR (re)generation —
 * the day can be up to a revalidate-window stale around midnight.
 */

import { ChevronDown, Clock, MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PublicEstablishmentDetail } from '@/lib/api/types';
import {
  normalizeWorkingHours,
  type ParsedDayHours,
} from '@/lib/establishment-helpers';

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;
const DAY_NAMES_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

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
  const priceRange = establishment.price_range;

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
        <HoursFact workingHours={establishment.working_hours} />
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

/**
 * «Сегодня» fact — summary shows today's hours; expands (native <details>) to
 * the full week, consecutive same-hours days grouped («Пн–Пт: 10:00 – 22:00»).
 */
function HoursFact({ workingHours }: { workingHours: unknown }) {
  const parsed = normalizeWorkingHours(workingHours);
  if (!parsed) return null;

  const todayIdx = (new Date().getDay() + 6) % 7; // Sun=0 → idx 6, Mon=1 → idx 0
  const groups = groupWeek(parsed, todayIdx);

  return (
    <div className='flex items-start gap-3'>
      <span className='flex size-10 shrink-0 items-center justify-center rounded-m bg-background text-brand'>
        <Clock className='size-5' aria-hidden='true' />
      </span>
      <div className='min-w-0'>
        <div className='text-body-s text-muted-foreground'>Сегодня</div>
        <details className='group'>
          <summary className='flex cursor-pointer list-none items-center gap-1 text-[15px] font-semibold text-foreground marker:hidden'>
            {formatDay(parsed[DAY_KEYS[todayIdx]])}
            <ChevronDown
              aria-hidden='true'
              className='size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180'
            />
          </summary>
          <table className='mt-2 text-body-s'>
            <tbody>
              {groups.map((g, i) => (
                <tr
                  key={i}
                  className={
                    g.isToday
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  }
                >
                  <td className='py-0.5 pr-3'>{g.label}</td>
                  <td className='py-0.5'>{g.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}

function formatDay(hours: ParsedDayHours | null): string {
  if (hours == null || hours.is_open === false) return 'Выходной';
  if (!hours.open || !hours.close) return 'Выходной';
  return `${hours.open} – ${hours.close}`;
}

/** Group consecutive days with identical hours, flagging the group with today. */
function groupWeek(
  parsed: Record<string, ParsedDayHours | null>,
  todayIdx: number,
): { label: string; time: string; isToday: boolean }[] {
  const groups: { label: string; time: string; isToday: boolean }[] = [];
  let i = 0;
  while (i < 7) {
    const time = formatDay(parsed[DAY_KEYS[i]]);
    let j = i + 1;
    let isToday = i === todayIdx;
    while (j < 7 && formatDay(parsed[DAY_KEYS[j]]) === time) {
      if (j === todayIdx) isToday = true;
      j++;
    }
    const label =
      i === j - 1
        ? `${DAY_NAMES_SHORT[i]}:`
        : `${DAY_NAMES_SHORT[i]}–${DAY_NAMES_SHORT[j - 1]}:`;
    groups.push({ label, time, isToday });
    i = j;
  }
  return groups;
}
