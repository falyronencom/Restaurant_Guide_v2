import { NextResponse } from 'next/server';

import { deleteEstablishmentAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — delete establishment (CAT-C-3.x B4). Buffered POST Route
 * Handler (same-origin guarded) over the backend DELETE /:id (owner-checked,
 * permanent, cascades media). POST for parity with the other cabinet handlers +
 * the CSRF guard; the backend verb stays DELETE.
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
  return NextResponse.json(await deleteEstablishmentAction(id));
}
