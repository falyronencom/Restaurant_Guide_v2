import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { E1_MIN_DESCRIPTION, E1_MIN_PHOTOS } from '@/lib/partner/constants';
import type { E1Checklist } from '@/lib/partner/validation';
import { cn } from '@/lib/utils';

/*
 * Sticky sidebar (Phase C Slice 1, Segment B). Live completeness mirror (client
 * base_score until the server draft exists, then the server value) + the E1
 * checklist that gates Submit. Submit is enabled only when E1 passes AND a server
 * draft exists (canSubmit) — the draft's existence guarantees the validator
 * minimum (name/city/address) was met.
 */

const ITEMS: { key: keyof Omit<E1Checklist, 'passed'>; label: string }[] = [
  { key: 'photos', label: `Фото заведения: от ${E1_MIN_PHOTOS}` },
  { key: 'menu', label: 'Меню: фото или PDF' },
  { key: 'classification', label: 'Категория и кухня' },
  { key: 'description', label: `Описание: от ${E1_MIN_DESCRIPTION} симв.` },
  { key: 'hours', label: 'Часы работы' },
];

export function StickySidebar({
  e1,
  completeness,
  serverScore,
  canSubmit,
  showSubmit,
  submitting,
  onSubmit,
  saveLabel,
  error,
  notice,
}: {
  e1: E1Checklist;
  completeness: number;
  serverScore: number | null;
  canSubmit: boolean;
  showSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  saveLabel: string;
  error: string | null;
  notice: string | null;
}) {
  const score = serverScore ?? completeness;
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <aside className="sticky top-l flex flex-col gap-l rounded-l border border-border bg-background p-l">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-label-m text-foreground">Готовность</span>
          <span className="text-label-m text-foreground">{clamped}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <p className="mt-1 text-caption-m text-figma-text-grey">
          {serverScore != null ? 'Оценка сервера' : 'Предварительная оценка'}
        </p>
      </div>

      <div>
        <p className="text-label-m text-foreground">Готовность к публикации</p>
        <ul className="mt-2 flex flex-col gap-2">
          {ITEMS.map((it) => {
            const done = e1[it.key];
            return (
              <li key={it.key} className="flex items-center gap-2 text-body-s">
                {done ? (
                  <Check className="size-4 shrink-0 text-success-dark" />
                ) : (
                  <X className="size-4 shrink-0 text-figma-text-grey" />
                )}
                <span
                  className={cn(done ? 'text-foreground' : 'text-figma-text-grey')}
                >
                  {it.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        {showSubmit && (
          <Button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
          >
            {submitting ? 'Отправка…' : 'Отправить на модерацию'}
          </Button>
        )}
        <p className="text-center text-caption-m text-figma-text-grey">
          {saveLabel}
        </p>
        {error && (
          <p className="text-center text-caption-m text-error-dark">{error}</p>
        )}
        {notice && (
          <p className="text-center text-caption-m text-success-dark">{notice}</p>
        )}
      </div>
    </aside>
  );
}
