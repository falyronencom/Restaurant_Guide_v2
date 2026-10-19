import { NextResponse } from 'next/server';

import { deleteAccount } from '@/lib/account/operations';
import { isDeletionWord } from '@/lib/account/deletion';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Account — delete it (brief В1, 18.10.2026; Google Play asks for a way to
 * delete the account without the app). Buffered POST Route Handler on the
 * cabinet transport pattern (CAT-C-3.14). Body: { confirmation } — the word
 * the person typed; without it nothing reaches the backend, and with it the
 * word goes on as typed (the backend checks it as well). On success the
 * operation clears the session cookies.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  let confirmation: unknown;
  try {
    confirmation = ((await request.json()) as { confirmation?: unknown }).confirmation;
  } catch {
    confirmation = undefined;
  }
  if (typeof confirmation !== 'string' || !isDeletionWord(confirmation)) {
    return NextResponse.json(
      { ok: false, code: 'CONFIRMATION_REQUIRED' },
      { status: 400 },
    );
  }
  return NextResponse.json(await deleteAccount(confirmation));
}
