import { NextResponse } from 'next/server';

import { loadMenuItemsAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — the card's recognised menu (the «Меню» section). Buffered
 * POST Route Handler like load: the authed read may rotate the refresh
 * cookie, and POST-only keeps the same-origin parity.
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
  return NextResponse.json(await loadMenuItemsAction(id));
}
