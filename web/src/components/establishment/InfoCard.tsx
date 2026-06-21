/**
 * InfoCard — Server Component (Brief 4).
 *
 * Renders the main establishment info block: title hierarchy + meta line
 * (category/cuisine/price_range) + status (via OpenStatusBadge — Brief 3
 * reuse) + address row + tappable phone + website chip + working-hours table.
 *
 * Reuses `OpenStatusBadge` (Brief 3 client island) for the live open/closed
 * status — the only Client surface inside InfoCard. Everything else is
 * Server-rendered.
 *
 * Working-hours rendering ports `_buildWorkingHours` logic from mobile
 * detail_screen.dart:988-1064 — groups consecutive days with identical hours
 * (e.g. «Пн-Пт: 10:00 - 22:00, Сб-Вс: 12:00 - 02:00»). Uses Establishment's
 * dual-format parser (string «10:00-22:00» OR object {is_open, open, close}).
 */

import { MapPin, Phone, Mail, Globe } from 'lucide-react';

import type { PublicEstablishmentDetail } from '@/lib/api/types';
import { normalizeWorkingHours } from '@/lib/establishment-helpers';

export function InfoCard({
  establishment,
}: {
  establishment: PublicEstablishmentDetail;
}) {
  return (
    <div className='flex flex-col gap-l rounded-l border border-border bg-background p-l'>
      {/* Address row */}
      <p className='flex items-start gap-s text-body-l text-foreground'>
        <MapPin className='mt-1 size-5 shrink-0 text-brand' aria-hidden='true' />
        <span>
          {establishment.address}, {establishment.city}
        </span>
      </p>

      {/* Contact row: phone + email + website */}
      <div className='flex flex-wrap gap-m'>
        {establishment.phone ? (
          <a
            href={`tel:${establishment.phone.replace(/\s/g, '')}`}
            className='inline-flex items-center gap-s rounded-s border border-border bg-background px-m py-s text-body-m text-foreground transition-colors hover:bg-muted'
          >
            <Phone className='size-4 text-brand' aria-hidden='true' />
            {establishment.phone}
          </a>
        ) : null}
        {establishment.email ? (
          <a
            href={`mailto:${establishment.email}`}
            className='inline-flex items-center gap-s rounded-s border border-border bg-background px-m py-s text-body-m text-foreground transition-colors hover:bg-muted'
          >
            <Mail className='size-4 text-brand' aria-hidden='true' />
            {establishment.email}
          </a>
        ) : null}
        {establishment.website ? (
          <a
            href={ensureUrlScheme(establishment.website)}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-s rounded-s border border-border bg-background px-m py-s text-body-m text-foreground transition-colors hover:bg-muted'
          >
            <Globe className='size-4 text-brand' aria-hidden='true' />
            Сайт
          </a>
        ) : null}
      </div>

      {/* Working hours table */}
      <WorkingHoursTable workingHours={establishment.working_hours} />
    </div>
  );
}

// -- internals --------------------------------------------------------------

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const DAY_NAMES_SHORT_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

function WorkingHoursTable({ workingHours }: { workingHours: unknown }) {
  const parsed = normalizeWorkingHours(workingHours);
  if (!parsed) {
    return (
      <p className='text-body-s text-muted-foreground'>График работы не указан</p>
    );
  }

  const todayIdx = (new Date().getDay() + 6) % 7; // Sun=0 → idx 6, Mon=1 → idx 0

  // Group consecutive days with identical hours
  const groups: { label: string; time: string; isToday: boolean }[] = [];
  let i = 0;
  while (i < 7) {
    const currentTime = formatDayHours(parsed[DAY_KEYS[i]]);
    let j = i + 1;
    let containsToday = i === todayIdx;
    while (j < 7 && formatDayHours(parsed[DAY_KEYS[j]]) === currentTime) {
      if (j === todayIdx) containsToday = true;
      j++;
    }
    const label =
      i === j - 1
        ? `${DAY_NAMES_SHORT_RU[i]}:`
        : `${DAY_NAMES_SHORT_RU[i]}–${DAY_NAMES_SHORT_RU[j - 1]}:`;
    groups.push({ label, time: currentTime, isToday: containsToday });
    i = j;
  }

  return (
    <div className='flex flex-col gap-1 rounded-m bg-figma-bg-warm p-m'>
      <h3 className='text-body-s font-medium text-muted-foreground'>Часы работы</h3>
      <table className='w-full text-body-m'>
        <tbody>
          {groups.map((g, idx) => (
            <tr key={idx} className={g.isToday ? 'font-medium text-foreground' : 'text-foreground'}>
              <td className='py-1 pr-m'>{g.label}</td>
              <td className='py-1'>{g.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DayHours = { is_open: boolean; open?: string; close?: string } | null;

function formatDayHours(hours: DayHours): string {
  if (hours == null) return 'Выходной';
  if (hours.is_open === false) return 'Выходной';
  if (!hours.open || !hours.close) return 'Выходной';
  return `${hours.open} – ${hours.close}`;
}

function ensureUrlScheme(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
