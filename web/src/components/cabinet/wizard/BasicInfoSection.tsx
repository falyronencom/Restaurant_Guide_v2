import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ATTRIBUTES,
  E1_MIN_DESCRIPTION,
  PRICE_RANGES,
} from '@/lib/partner/constants';
import { contactErrors } from '@/lib/partner/contacts';
import { priceRangeLabel } from '@/lib/price-range';

import { Chip, Field, SectionCard } from './primitives';
import type { SectionProps } from './types';

/*
 * Basic info: name, description, contacts, average check, amenities. Attributes
 * write the 10-key canon (Decision 4) — the keys readers consume. Price is a
 * single-select chip ($/$$/$$$ — the validator's exact set), labelled with the
 * same words as the card and the filters («$$ · до 50 руб», lib/price-range.ts):
 * a bare «$$» left the partner guessing. The value saved stays «$$».
 */
export function BasicInfoSection({ form, patch, disabled }: SectionProps) {
  const descLen = form.description.trim().length;
  // Each contact that does not pass says so under itself; it is left out of
  // the save, the rest is saved (contacts.ts, С6).
  const errors = contactErrors(form);

  const toggleAttr = (key: string) => {
    patch({
      attributes: form.attributes.includes(key)
        ? form.attributes.filter((k) => k !== key)
        : [...form.attributes, key],
    });
  };

  return (
    <SectionCard
      id="section-basic"
      title="Основное"
      description="Название, описание и контакты заведения."
    >
      <Field label="Название" htmlFor="f-name">
        <Input
          id="f-name"
          value={form.name}
          disabled={disabled}
          maxLength={255}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Например, Кафе «Весна»"
        />
      </Field>

      <Field
        label="Описание"
        htmlFor="f-desc"
        hint={`${descLen} симв. · по желанию — можно оставить пустым (от ${E1_MIN_DESCRIPTION} для полного описания)`}
      >
        <Textarea
          id="f-desc"
          value={form.description}
          disabled={disabled}
          maxLength={2000}
          rows={5}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Расскажите о заведении, кухне и атмосфере…"
        />
      </Field>

      <div className="grid gap-l sm:grid-cols-2">
        <Field
          label="Телефон"
          htmlFor="f-phone"
          hint="Формат: +375XXXXXXXXX"
          error={errors.phone}
          errorId="f-phone-error"
        >
          <Input
            id="f-phone"
            value={form.phone}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? 'f-phone-error' : undefined}
            disabled={disabled}
            inputMode="tel"
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="+375291234567"
          />
        </Field>
        <Field
          label="Email"
          htmlFor="f-email"
          error={errors.email}
          errorId="f-email-error"
        >
          <Input
            id="f-email"
            type="email"
            value={form.email}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'f-email-error' : undefined}
            disabled={disabled}
            onChange={(e) => patch({ email: e.target.value })}
            placeholder="info@example.by"
          />
        </Field>
      </div>

      <Field
        label="Сайт или соцсеть"
        htmlFor="f-website"
        error={errors.website}
        errorId="f-website-error"
      >
        <Input
          id="f-website"
          value={form.website}
          aria-invalid={errors.website ? true : undefined}
          aria-describedby={errors.website ? 'f-website-error' : undefined}
          disabled={disabled}
          inputMode="url"
          onChange={(e) => patch({ website: e.target.value })}
          placeholder="https://…"
        />
      </Field>

      <Field label="Средний чек">
        {/* Wraps: three «$$$ · более 50 руб» do not fit one narrow row. */}
        <div className="flex flex-wrap gap-2" data-testid="price-range-chips">
          {PRICE_RANGES.map((p) => (
            <Chip
              key={p}
              active={form.priceRange === p}
              disabled={disabled}
              onClick={() =>
                patch({ priceRange: form.priceRange === p ? '' : p })
              }
            >
              {priceRangeLabel(p)}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Удобства">
        <div className="flex flex-wrap gap-2">
          {ATTRIBUTES.map((a) => (
            <Chip
              key={a.key}
              active={form.attributes.includes(a.key)}
              disabled={disabled}
              onClick={() => toggleAttr(a.key)}
            >
              {a.label}
            </Chip>
          ))}
        </div>
      </Field>
    </SectionCard>
  );
}
