import { NextResponse } from 'next/server';

import { loadFavorites } from '@/lib/account/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Account — favorites list (user-ЛК Slice 1). Buffered POST Route Handler on
 * the cabinet transport pattern (CAT-C-3.14): edge-503-immune, same-origin
 * CSRF guard, {ok,…} JSON envelope. POST, not GET: the call rides authedFetch,
 * which may rotate the single-use refresh cookie (not an idempotent read).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  let page = 1;
  try {
    const body = (await request.json()) as { page?: unknown };
    if (
      typeof body.page === 'number' &&
      Number.isInteger(body.page) &&
      body.page >= 1
    ) {
      page = body.page;
    }
  } catch {
    // No/malformed body → first page (the parameter is optional).
  }
  return NextResponse.json(await loadFavorites(page));
}
