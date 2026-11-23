import { NextResponse } from 'next/server';

import { retryOcrAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — «Перезапустить распознавание» of the «Меню» section
 * (CAT-C-3.14 transport: a buffered POST Route Handler). Every menu file is
 * read again, the recognised ones too; saving the card queues new menu files
 * by itself (backend establishmentService media sync). Answers how many files
 * were queued, or which limit refused (lib/partner/operations retryOcrAction).
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
  return NextResponse.json(await retryOcrAction(id));
}
