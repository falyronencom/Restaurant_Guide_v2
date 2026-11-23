'use client';

import { refreshCardPageAction } from '@/lib/partner/client';
import type { PageRefresh } from '@/lib/partner/results';

/*
 * The deferred drop of a card's public page, kept by the cabinet's browser
 * (lib/partner/card-page.ts: a drop cannot be timed on the server —
 * revalidatePath works only inside a request).
 *
 * A write inside the card's interval answers «not now, retry in N ms»; this
 * module calls refresh-page then. One timer per card, the earliest wins —
 * later writes inside the same interval ride on it. Module scope, so it
 * outlives the section's island when the partner moves between «Карточка»
 * and «Меню». When the page goes away with a drop still waiting (pagehide),
 * the drop is sent at once as `final` with keepalive: the server takes it
 * without the interval, inside the account's hour. If even that does not
 * arrive, the page renews by itself within the hour.
 */

/** A little after the interval ends, so the server's clock agrees it has. */
const MARGIN_MS = 500;

const pending = new Map<string, ReturnType<typeof setTimeout>>();
let listening = false;

function flushAllFinal(): void {
  for (const [cardId, timer] of pending) {
    clearTimeout(timer);
    void refreshCardPageAction(cardId, { final: true });
  }
  pending.clear();
}

/**
 * A phone that sends the tab to the background may unload it later without
 * a `pagehide` (Phase 4.5, regular LOW 3): a hidden page flushes as well. The
 * server takes a `final` only for a drop it deferred itself.
 */
function onHidden(): void {
  if (document.visibilityState === 'hidden') flushAllFinal();
}

function listenForLeave(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', flushAllFinal);
  document.addEventListener('visibilitychange', onHidden);
}

/** Ask refresh-page for this card in `inMs` — unless an earlier ask already waits. */
export function scheduleCardPageRefresh(cardId: string, inMs: number): void {
  if (pending.has(cardId)) return;
  listenForLeave();
  const timer = setTimeout(async () => {
    pending.delete(cardId);
    const r = await refreshCardPageAction(cardId);
    // Still inside the interval (another write dropped meanwhile): once more.
    if (r.ok && !r.page.refreshed && r.page.retryInMs) {
      scheduleCardPageRefresh(cardId, r.page.retryInMs);
    }
  }, Math.max(0, inMs) + MARGIN_MS);
  pending.set(cardId, timer);
}

/** After a write: a deferred drop gets its timer; a done or refused one needs nothing. */
export function followPageRefresh(cardId: string, page: PageRefresh | undefined): void {
  if (page && !page.refreshed && page.retryInMs) scheduleCardPageRefresh(cardId, page.retryInMs);
}

/** Test-only: forget every timer. */
export function _resetForTests(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  if (listening && typeof window !== 'undefined') {
    window.removeEventListener('pagehide', flushAllFinal);
    document.removeEventListener('visibilitychange', onHidden);
  }
  listening = false;
}
