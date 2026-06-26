import { NextResponse } from 'next/server';

import type { UpdateEstablishmentPayload } from '@/lib/api/types';
import { updateEstablishmentAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — autosave / edit PUT (CAT-C-3.14). Buffered POST Route
 * Handler replacing the updateEstablishmentAction Server Action. The body is
 * forwarded VERBATIM to the backend PUT — do NOT reshape it: the menu_photos /
 * menu-PDF preservation contract lives in toUpdatePayload (client-side), and a
 * transport rewrite must not drop fields the backend media-sync reads.
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

  let payload: UpdateEstablishmentPayload;
  try {
    payload = (await request.json()) as UpdateEstablishmentPayload;
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }

  return NextResponse.json(await updateEstablishmentAction(id, payload));
}
