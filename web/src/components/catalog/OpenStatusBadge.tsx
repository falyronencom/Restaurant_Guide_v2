'use client';

import { useEffect, useState } from 'react';

import { computeOpenStatus, type OpenStatus } from '@/lib/working-hours';

/**
 * Live open/closed badge — client island.
 *
 * Per Brief 3 spec: re-compute on mount only (Coordinator Q3 answer).
 * Each component instance computes its own `openStatus` on mount via
 * `useEffect`, ensuring per-mount freshness on SPA navigation (server
 * navigation re-mounts the client island with current wall-clock time).
 *
 * Server renders a neutral placeholder ("Часы работы") to avoid hydration
 * mismatch when ISR-cached HTML (revalidate=3600) is older than current
 * time. Client computes status on mount and replaces the placeholder.
 *
 * About the eslint-disable: `react-hooks/set-state-in-effect` is intended
 * to prevent cascading renders. This effect runs once on mount (empty
 * deps) and sets state from a real external system (wall clock) — the
 * exact "subscribe to external system" exception the rule's own docs
 * describe, only the linter doesn't recognize `new Date()` as such.
 *
 * Color mapping (mirrors mobile establishment_card.dart status block):
 *   "Открыто"   → success-status (#34C759, Figma open green)
 *   "Закрыто"   → destructive (mobile uses Colors.red; mapped to shadcn destructive)
 *   "/ до HH:MM" → foreground (neutral suffix)
 */
export function OpenStatusBadge({
  workingHours,
  status,
}: {
  workingHours: unknown;
  status: string;
}) {
  const [openStatus, setOpenStatus] = useState<OpenStatus | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount computation reading external clock
    setOpenStatus(computeOpenStatus(workingHours, status, new Date()));
  }, [workingHours, status]);

  if (!openStatus) {
    return (
      <span className='text-body-m text-muted-foreground'>Часы работы</span>
    );
  }

  return (
    <span className='text-body-m font-medium'>
      <span
        className={
          openStatus.isOpen ? 'text-success-status' : 'text-destructive'
        }
      >
        {openStatus.isOpen ? 'Открыто' : 'Закрыто'}
      </span>
      {openStatus.isOpen && openStatus.closingTime && (
        <span className='font-normal text-foreground'>
          {' / до '}
          {openStatus.closingTime}
        </span>
      )}
    </span>
  );
}
