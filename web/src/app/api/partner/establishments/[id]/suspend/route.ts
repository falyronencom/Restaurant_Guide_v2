import { NextResponse } from 'next/server';

import { suspendEstablishmentAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — pause a published card (active → suspended), the
 * partner's own pause, which «Возобновить показ» lifts. Buffered POST Route
 * Handler, like resume. A card that is not published is the server's to
 * refuse (400 INVALID_STATUS_TRANSITION).
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
  return NextResponse.json(await suspendEstablishmentAction(id));
}
