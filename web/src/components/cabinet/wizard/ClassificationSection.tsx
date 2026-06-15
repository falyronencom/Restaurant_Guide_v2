import {
  CATEGORIES,
  CUISINES,
  MAX_CATEGORIES,
  MAX_CUISINES,
} from '@/lib/partner/constants';

import { Chip, Field, SectionCard } from './primitives';
import type { SectionProps } from './types';

/*
 * Classification: categories (≤2) + cuisines (≤3), Cyrillic canon (Decision 2).
 * Chips write the canonical names directly — the values the backend validator
 * accepts via isIn().
 */
export function ClassificationSection({ form, patch, disabled }: SectionProps) {
  const toggle = (
    list: string[],
    value: string,
    max: number,
    key: 'categories' | 'cuisines',
  ) => {
    if (list.includes(value)) {
      patch({ [key]: list.filter((x) => x !== value) });
    } else if (list.length < max) {
      patch({ [key]: [...list, value] });
    }
  };

  return (
    <SectionCard
      id="section-classification"
      title="Классификация"
      description="Выберите тип заведения и кухню — так гости находят вас в каталоге."
    >
      <Field label={`Категории — до ${MAX_CATEGORIES}`}>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const active = form.categories.includes(c);
            return (
              <Chip
                key={c}
                active={active}
                disabled={
                  disabled || (!active && form.categories.length >= MAX_CATEGORIES)
                }
                onClick={() =>
                  toggle(form.categories, c, MAX_CATEGORIES, 'categories')
                }
              >
                {c}
              </Chip>
            );
          })}
        </div>
      </Field>

      <Field label={`Кухни — до ${MAX_CUISINES}`}>
        <div className="flex flex-wrap gap-2">
          {CUISINES.map((c) => {
            const active = form.cuisines.includes(c);
            return (
              <Chip
                key={c}
                active={active}
                disabled={
                  disabled || (!active && form.cuisines.length >= MAX_CUISINES)
                }
                onClick={() => toggle(form.cuisines, c, MAX_CUISINES, 'cuisines')}
              >
                {c}
              </Chip>
            );
          })}
        </div>
      </Field>
    </SectionCard>
  );
}
