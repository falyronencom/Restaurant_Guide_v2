import 'server-only';

import { currentVisitor } from '@/lib/api/visitor';

/*
 * How often visitors' requests may drop a cached card page (thread «2Г: общие
 * пределы», review of 10.11.2026).
 *
 * A card page is ISR: once dropped (revalidatePath), its next view renders it
 * anew, and that render calls the API from the site's own budget — the card,
 * its menu, its reviews (lib/api/visitor.ts: an ISR render names no visitor).
 * Five Server Actions drop it — a review written, edited or deleted, and the
 * menu or the reviews loaded again after the page's own fetch failed — and any
 * browser may call the last two. So one visitor's request, a single call from
 * their own budget, cost the site's budget three or more, and enough of them
 * spent it: the pages not cached yet showed «Что-то пошло не так» to everyone
 * till the hour renewed.
 *
 * Now a drop is taken from an allowance of the hour: DROPS_PER_HOUR for the
 * whole site — at most about a twentieth of the site's own budget (6000 an
 * hour, backend rateLimiter.js) — and DROPS_PER_VISITOR_HOUR for one visitor,
 * so that one visitor does not take the hour of the others. Past it the page is
 * not dropped and renews by itself within the hour (revalidate = 3600): a new
 * review shows on the card page later, the reviews page (force-dynamic) shows it
 * at once; the action itself answers as before. The numbers follow the hour's
 * allowance of unknown slugs (lib/known-slugs.ts MISSES_PER_HOUR). Per
 * instance, in memory: the site runs one.
 *
 * The visitor is the address the edge names (currentVisitor); without one —
 * outside a request, or in development — one shared key.
 */

export const DROPS_PER_HOUR = 120;
export const DROPS_PER_VISITOR_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;
const NO_VISITOR = 'no-visitor';

let hour = { start: 0, total: 0, byVisitor: new Map<string, number>() };

/**
 * Whether a cached card page may be dropped now; true takes one drop from the
 * hour's allowance. The map holds at most DROPS_PER_HOUR visitors: one is
 * written only when a drop is granted. Every check runs after the one await,
 * next to the count it guards: checked before it, a burst of requests waiting
 * there together passed the hour's total all at once (second review,
 * 10.11.2026).
 */
export async function mayDropCachedPage(): Promise<boolean> {
  const visitor = (await currentVisitor()) ?? NO_VISITOR;
  const now = Date.now();
  if (now - hour.start >= HOUR_MS) hour = { start: now, total: 0, byVisitor: new Map() };
  if (hour.total >= DROPS_PER_HOUR) return false;
  const spent = hour.byVisitor.get(visitor) ?? 0;
  if (spent >= DROPS_PER_VISITOR_HOUR) return false;
  hour.byVisitor.set(visitor, spent + 1);
  hour.total += 1;
  return true;
}

/** Test-only: a fresh hour. */
export function _resetForTests(): void {
  hour = { start: 0, total: 0, byVisitor: new Map() };
}
