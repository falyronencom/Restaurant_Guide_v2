'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { PublicMenuItem } from '@/lib/api/types';
import { reloadMenuAction, type ReloadMenuResult } from '@/lib/menu/actions';

import { MenuAutoExtractedNote, MenuItemsList } from './MenuItemsList';

/**
 * MenuLoadFailed — client island in place of the text menu when the detail
 * page could not load it (сверка находок тестировщика с сайтом, 18.10, Ш8).
 *
 * Before: the page swallowed the failure into an empty list, so the visitor
 * read «Меню пока не загружено.» about a place whose menu is there, and the
 * ISR page kept that for up to an hour. Now the island loads the items itself
 * on mount (reloadMenuAction — which also drops the cached failed page), draws
 * the regular menu once they arrive, and says plainly that the menu did not
 * load — with «Повторить» — if that fails too. Menu photos and PDFs come with
 * the establishment itself and stay on screen around it. Only a loaded,
 * genuinely empty text menu with no photos or PDFs says «Меню пока не
 * загружено.» — the same words MenuBlock uses.
 */
type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; menuItems: PublicMenuItem[] };

export function MenuLoadFailed({
  slug,
  detailPath,
  hasOtherMenu,
}: {
  slug: string;
  detailPath: string;
  /** Menu photos or PDFs are shown — an empty text menu then says nothing. */
  hasOtherMenu: boolean;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Bumped by «Повторить»: each value is one more load attempt.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    reloadMenuAction({ slug, detailPath })
      // The action itself unreachable (network) — same as a failed fetch.
      .catch((): ReloadMenuResult => ({ ok: false }))
      .then((result) => {
        if (cancelled) return;
        setState(
          result.ok
            ? { status: 'loaded', menuItems: result.menuItems }
            : { status: 'failed' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug, detailPath, attempt]);

  if (state.status === 'loaded') {
    if (state.menuItems.length > 0) {
      return (
        <div className='flex flex-col gap-4'>
          <div>
            <MenuAutoExtractedNote />
          </div>
          <MenuItemsList menuItems={state.menuItems} />
        </div>
      );
    }
    return hasOtherMenu ? null : (
      <p className='text-body-m text-muted-foreground'>
        Меню пока не загружено.
      </p>
    );
  }

  return state.status === 'loading' ? (
    <p
      role='status'
      className='rounded-card bg-figma-bg-warm p-l text-body-m text-muted-foreground'
    >
      Загружаем меню…
    </p>
  ) : (
    <div
      role='alert'
      className='flex flex-wrap items-center justify-between gap-m rounded-card bg-figma-bg-warm p-l'
    >
      <p className='text-body-m text-foreground'>Не удалось загрузить меню.</p>
      <Button
        variant='outline'
        onClick={() => {
          setState({ status: 'loading' });
          setAttempt((n) => n + 1);
        }}
      >
        Повторить
      </Button>
    </div>
  );
}
