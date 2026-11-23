import { NextResponse } from 'next/server';

import type { UpdateEstablishmentPayload } from '@/lib/api/types';
import { updateEstablishmentAction } from '@/lib/partner/operations';
import { assertSameOrigin, searchParamsOf } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — autosave / edit PUT (CAT-C-3.14). Buffered POST Route
 * Handler replacing the updateEstablishmentAction Server Action. The body is
 * forwarded VERBATIM to the backend PUT — do NOT reshape it: the menu_photos /
 * menu-PDF preservation contract lives in toUpdatePayload (client-side), and a
 * transport rewrite must not drop fields the backend media-sync reads.
 *
 * `?prevCity=&prevCategory=` — the form's last accepted city and first
 * category: a save of a published card drops the card's public page, and when
 * the save moved the card to another address, the old one too. The server
 * builds both addresses itself from its maps and the card's slug in the API's
 * answer (lib/partner/card-page.ts); the hint can only name an address of
 * this card.
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

  const query = searchParamsOf(request);
  const city = query.get('prevCity');
  const category = query.get('prevCategory');

  return NextResponse.json(
    city || category
      ? await updateEstablishmentAction(id, payload, { city, category })
      : await updateEstablishmentAction(id, payload),
  );
}
