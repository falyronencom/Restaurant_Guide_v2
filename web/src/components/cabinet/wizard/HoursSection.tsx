import { Input } from '@/components/ui/input';
import { DAY_KEYS, DAY_LABELS, type DayKey } from '@/lib/partner/constants';
import type { DayHoursForm } from '@/lib/partner/form';

import { Chip, SectionCard } from './primitives';
import type { SectionProps } from './types';

/*
 * Working hours — canonical per-day (Q10). NO silent defaults: every day starts
 * closed, the partner opens and sets real times (E1 requires observed hours).
 * Midnight is '00:00' (the native time input already yields 2-digit HH:MM).
 */
export function HoursSection({ form, patch, disabled }: SectionProps) {
  const setDay = (day: DayKey, next: Partial<DayHoursForm>) => {
    patch({
      workingHours: {
        ...form.workingHours,
        [day]: { ...form.workingHours[day], ...next },
      },
    });
  };

  return (
    <SectionCard
      id="section-hours"
      title="Часы работы"
      description="Укажите реальные часы работы по дням — без значений по умолчанию."
    >
      <div className="flex flex-col gap-3">
        {DAY_KEYS.map((day) => {
          const d = form.workingHours[day];
          return (
            <div key={day} className="flex flex-wrap items-center gap-3">
              <span className="w-28 shrink-0 text-body-m text-foreground">
                {DAY_LABELS[day]}
              </span>
              <Chip
                active={d.isOpen}
                disabled={disabled}
                onClick={() => setDay(day, { isOpen: !d.isOpen })}
              >
                {d.isOpen ? 'Открыто' : 'Выходной'}
              </Chip>
              {d.isOpen && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label={`${DAY_LABELS[day]} — открытие`}
                    value={d.open}
                    disabled={disabled}
                    onChange={(e) => setDay(day, { open: e.target.value })}
                    className="w-32"
                  />
                  <span className="text-figma-text-grey">—</span>
                  <Input
                    type="time"
                    aria-label={`${DAY_LABELS[day]} — закрытие`}
                    value={d.close}
                    disabled={disabled}
                    onChange={(e) => setDay(day, { close: e.target.value })}
                    className="w-32"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
