'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  loadEstablishmentForEdit,
  loadEstablishments,
} from '@/lib/partner/client';
import { fromDetail, type WizardFormState } from '@/lib/partner/form';

import { Field, SectionCard } from './primitives';

/*
 * Copy-from-previous (Phase C Slice 1, Segment B). Create-mode only. Prefills
 * city / attributes / price / hours from one of the partner's existing cards
 * (NOT media/name/address — Decision). The donor's attributes + hours live only
 * on the detail projection, so the chosen card is loaded on apply and run through
 * fromDetail; the four copy-allowed fields are then lifted out.
 */
export function CopyFromPrevious({
  onApply,
}: {
  onApply: (partial: Partial<WizardFormState>) => void;
}) {
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEstablishments()
      .then((r) => {
        if (!cancelled && r.ok) {
          setOptions(r.establishments.map((e) => ({ id: e.id, name: e.name })));
        }
      })
      .catch(() => {
        /* copy is optional — a load failure simply hides it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (options.length === 0) return null;

  const apply = async () => {
    if (!selected) return;
    setLoading(true);
    setMsg(null);
    const r = await loadEstablishmentForEdit(selected);
    setLoading(false);
    if (r.ok) {
      const f = fromDetail(r.establishment);
      onApply({
        city: f.city,
        attributes: f.attributes,
        priceRange: f.priceRange,
        workingHours: f.workingHours,
      });
      setMsg('Скопировано: город, удобства, чек и часы.');
    } else {
      setMsg('Не удалось скопировать данные.');
    }
  };

  return (
    <SectionCard
      title="Скопировать из другого заведения"
      description="Перенос города, удобств, чека и часов из вашей карточки — фото, название и адрес не копируются."
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Заведение">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 w-full min-w-56 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">Выберите…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selected || loading}
          onClick={apply}
        >
          {loading ? 'Копирование…' : 'Скопировать'}
        </Button>
      </div>
      {msg && <p className="text-caption-m text-figma-text-grey">{msg}</p>}
    </SectionCard>
  );
}
