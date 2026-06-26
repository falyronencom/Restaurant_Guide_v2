import { NextResponse } from 'next/server';

import type { CreateEstablishmentPayload } from '@/lib/api/types';
import { createEstablishmentAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — create draft (CAT-C-3.14). Buffered POST Route Handler
 * replacing the createEstablishmentAction Server Action. The first create
 * upgrades user→partner and rotates the session (refreshSession inside the
 * operation): cookie writes are legal here, exactly as in a Server Action, and
 * the rotated cookies ride out on this response.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  let payload: CreateEstablishmentPayload;
  try {
    payload = (await request.json()) as CreateEstablishmentPayload;
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }

  return NextResponse.json(await createEstablishmentAction(payload));
}
