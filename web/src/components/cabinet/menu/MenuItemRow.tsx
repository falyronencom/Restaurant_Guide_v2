'use client';

import { useState } from 'react';
import { Check, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MENU_TEXTS } from '@/lib/partner/cabinet-texts';
import { updateMenuItemAction } from '@/lib/partner/client';
import { refusalMessage } from '@/lib/partner/errors';
import type { PartnerMenuItem } from '@/lib/partner/menu';
import { confirmChangesOf, flagReasonText, formatMenuPrice } from '@/lib/partner/menu-format';
import type { PageRefresh } from '@/lib/partner/results';

import { MenuItemEditor } from './MenuItemEditor';

/*
 * One line of the «Меню» section: name, price as on the public page, the mark
 * «Требует внимания» with its reason in words (never the raw code), «Всё
 * верно» for a marked line (T8: the line sent back as it is — the server
 * clears the mark of the line and its copies), and the note for alcohol and
 * tobacco, which the guest does not see.
 */
export function MenuItemRow({
  item,
  sections,
  onSaved,
  onGone,
}: {
  item: PartnerMenuItem;
  sections: readonly string[];
  onSaved: (item: PartnerMenuItem, page: PageRefresh | undefined) => void;
  onGone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmCorrect = async () => {
    if (confirming) return;
    setConfirming(true);
    setError(null);
    const r = await updateMenuItemAction(item.id, confirmChangesOf(item));
    setConfirming(false);
    if (r.ok) onSaved(r.item, r.page);
    else if (r.code === 'MENU_ITEM_NOT_FOUND') onGone();
    else setError(refusalMessage(r));
  };

  return (
    <li className="flex flex-col gap-s border-t border-figma-divider py-m first:border-t-0">
      <div className="flex items-start gap-m">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body-m text-foreground wrap-anywhere">{item.item_name}</span>
          {item.guest_hidden_reason && (
            <span className="text-caption-m text-figma-text-grey">{MENU_TEXTS.guestHidden}</span>
          )}
        </div>
        <span
          className={`shrink-0 whitespace-nowrap text-body-m font-semibold ${
            item.price_byn == null ? 'text-figma-text-grey' : 'text-foreground'
          }`}
        >
          {formatMenuPrice(item.price_byn)}
        </span>
        <MenuItemEditor item={item} sections={sections} onSaved={onSaved} onGone={onGone} />
      </div>
      {item.sanity_flag && (
        <div className="flex flex-col gap-s rounded-[var(--radius-m)] border border-brand/30 bg-brand/5 p-s sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brand-dark" aria-hidden="true" />
            <div className="flex flex-col gap-0.5">
              <span className="text-caption-m font-medium text-brand-dark">{MENU_TEXTS.attention}</span>
              <span className="text-body-s text-figma-text-dark">{flagReasonText(item.sanity_flag)}</span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={confirmCorrect}
            aria-disabled={confirming || undefined}
            className="self-start sm:self-center"
          >
            <Check />
            {confirming ? MENU_TEXTS.confirmingCorrect : MENU_TEXTS.confirmCorrect}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-caption-m text-error-dark" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
