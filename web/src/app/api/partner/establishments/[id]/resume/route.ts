import { NextResponse } from 'next/server';

import { resumeEstablishmentAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — resume a card the partner paused (suspended → active).
 * Buffered POST Route Handler, like submit. A moderator's suspension is the
 * server's to refuse (403 ADMIN_SUSPENDED).
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
  return NextResponse.json(await resumeEstablishmentAction(id));
}
