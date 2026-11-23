import { NextResponse } from 'next/server';

import { refreshCardPageAction } from '@/lib/partner/operations';
import { assertSameOrigin, searchParamsOf } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — drop the card's public page, if the card is published
 * (lib/partner/card-page.ts): after a re-recognition the «Меню» section saw
 * end, or when a write's drop was deferred by the card's interval. The card
 * is read from the API here — its address is never taken from the browser.
 * `?final=1` — the partner leaves the page with a drop still deferred
 * (sent keepalive): dropped without the interval, inside the account's hour.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const final = searchParamsOf(request).get('final') === '1';
  return NextResponse.json(await refreshCardPageAction(id, { final }));
}
