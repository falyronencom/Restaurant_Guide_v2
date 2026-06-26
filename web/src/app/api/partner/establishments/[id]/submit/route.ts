import { NextResponse } from 'next/server';

import { submitEstablishmentAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — submit for moderation (CAT-C-3.14). Buffered POST Route
 * Handler replacing the submitEstablishmentAction Server Action.
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
  return NextResponse.json(await submitEstablishmentAction(id));
}
