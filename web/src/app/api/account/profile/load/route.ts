import { NextResponse } from 'next/server';

import { loadProfile } from '@/lib/account/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Account — profile load (user-ЛК Slice 1). Buffered POST Route Handler on the
 * cabinet transport pattern (CAT-C-3.14). Serves the fresh /auth/me user (the
 * rg_user display cookie carries no emailVerified/authMethod). POST: rides
 * authedFetch, which may rotate the single-use refresh cookie.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  return NextResponse.json(await loadProfile());
}
