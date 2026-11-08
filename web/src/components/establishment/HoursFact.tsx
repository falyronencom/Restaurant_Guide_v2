'use client';

import { ChevronDown, Clock } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import type { ParsedDayHours } from '@/lib/establishment-helpers';

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;
const DAY_NAMES_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

/** Nothing to subscribe to: the day is read on each render in the browser. */
const subscribe = () => () => {};
/** Today by the reader's own clock. JS getDay() is Sun=0…Sat=6, the week Mon…Sun. */
const todayInBrowser = () => (new Date().getDay() + 6) % 7;
/** The server has no «today» to give: see the component's comment. */
const noTodayOnServer = () => null;

/**
 * «Сегодня» fact of the info card — a client island. The summary shows today's
 * hours; it expands (native <details>) to the full week, consecutive same-hours
 * days grouped («Пн–Пт: 10:00 – 22:00»).
 *
 * Which day is today is the reader's. The page is rendered on the server, whose
 * clock is UTC, and kept up to an hour (ISR): from 00:00 to 03:00 in Minsk the
 * server would mark yesterday (finding of the hours thread; Coordinator,
 * 08.11.2026, «Да на 1–4»). So the server sends the week and the browser picks
 * today, as the status badge does. Until then — the server HTML, no JS — the
 * fact reads «Часы работы» and opens to the same week with nothing marked.
 * useSyncExternalStore gives the server snapshot while hydrating and the
 * browser's right after, with no mismatch.
 */
export function HoursFact({
  week,
}: {
  week: Record<string, ParsedDayHours | null>;
}) {
  const todayIdx = useSyncExternalStore(
    subscribe,
    todayInBrowser,
    noTodayOnServer,
  );
  const groups = groupWeek(week, todayIdx);

  return (
    <div className='flex items-start gap-3'>
      <span className='flex size-10 shrink-0 items-center justify-center rounded-m bg-background text-brand'>
        <Clock className='size-5' aria-hidden='true' />
      </span>
      <div className='min-w-0'>
        <div className='text-body-s text-muted-foreground'>
          {todayIdx === null ? 'Часы работы' : 'Сегодня'}
        </div>
        <details className='group'>
          <summary className='flex cursor-pointer list-none items-center gap-1 text-[15px] font-semibold text-foreground marker:hidden'>
            {todayIdx === null ? 'Показать' : formatDay(week[DAY_KEYS[todayIdx]])}
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

/**
 * A day without data is not a day off (Coordinator, 06.11.2026): the status badge
 * over it reads «Часы не указаны».
 */
function formatDay(hours: ParsedDayHours | null): string {
  if (hours?.is_open === false) return 'Выходной';
  if (!hours?.open || !hours.close) return 'Не указано';
  return `${hours.open} – ${hours.close}`;
}

/** Group consecutive days with identical hours, flagging the group with today. */
function groupWeek(
  week: Record<string, ParsedDayHours | null>,
  todayIdx: number | null,
): { label: string; time: string; isToday: boolean }[] {
  const groups: { label: string; time: string; isToday: boolean }[] = [];
  let i = 0;
  while (i < 7) {
    const time = formatDay(week[DAY_KEYS[i]]);
    let j = i + 1;
    let isToday = i === todayIdx;
    while (j < 7 && formatDay(week[DAY_KEYS[j]]) === time) {
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
