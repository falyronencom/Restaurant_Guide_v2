import { NextResponse } from 'next/server';

import { retryOcrAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — re-enqueue menu OCR (CAT-C-3.14). Buffered POST Route
 * Handler replacing the retryOcrAction Server Action. Recovery for the
 * PUT-media-sync OCR asymmetry (menu photos added via PUT do not auto-enqueue).
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
