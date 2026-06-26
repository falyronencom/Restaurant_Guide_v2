import { NextResponse } from 'next/server';

import { loadEstablishmentForEdit } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — load one establishment for the edit wizard (CAT-C-3.14).
 * Buffered POST Route Handler replacing the loadEstablishmentForEdit Server
 * Action. POST (not GET) for the same reason as /list — the authed read may
 * rotate the refresh cookie, and POST-only carries the CSRF parity.
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
  return NextResponse.json(await loadEstablishmentForEdit(id));
}
