import { NextResponse } from 'next/server';

import { updateProfile } from '@/lib/account/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Account — profile update (user-ЛК Slice 1). Buffered POST Route Handler on
 * the cabinet transport pattern (CAT-C-3.14). Body: { name } — the only
 * profile field this slice writes. On success the operation re-stamps the
 * rg_user display cookie (legal in a Route Handler).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  let name: string;
  try {
    const body = (await request.json()) as { name?: unknown };
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      throw new Error('invalid name');
    }
    name = body.name;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }
  return NextResponse.json(await updateProfile(name));
}
