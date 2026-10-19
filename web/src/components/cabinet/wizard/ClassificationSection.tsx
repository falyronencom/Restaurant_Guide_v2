import {
  CATEGORIES,
  CUISINES,
  MAX_CATEGORIES,
  MAX_CUISINES,
  isCuisineRequired,
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

  // Decision В5 (17.10.2026), widened 19.10.2026 (Ш17): a bar, a club, a
  // hookah lounge, bowling, karaoke or billiards may leave the cuisine out.
  const cuisineOptional =
    form.categories.length > 0 && !isCuisineRequired(form.categories);

  return (
    <SectionCard
      id="section-classification"
      title="Классификация"
      description="Выберите тип заведения и кухню — так гости находят вас в каталоге. Бару, клубу, кальянной, боулингу, караоке и бильярду кухню можно не выбирать."
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

      <Field
        label={
          cuisineOptional
            ? `Кухни — до ${MAX_CUISINES}, по желанию`
            : `Кухни — до ${MAX_CUISINES}`
        }
      >
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
