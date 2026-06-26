import { NextResponse } from 'next/server';

import { loadEstablishments } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — list establishments (CAT-C-3.14). Buffered POST Route
 * Handler replacing the loadEstablishments Server Action (Railway edge-503
 * immunity). POST, not GET: the call rides authedFetch, which may rotate the
 * single-use refresh cookie (so it is NOT an idempotent read), and POST-only is
 * part of the same-origin CSRF parity restored by the guard.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  return NextResponse.json(await loadEstablishments());
}
