import { NextResponse } from 'next/server';

import { checkAccountDeletion } from '@/lib/account/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Account — may the account be deleted now (brief В1, 18.10.2026). Buffered
 * POST Route Handler on the cabinet transport pattern (CAT-C-3.14): the
 * profile island asks before it shows the confirmation word, so a holder of
 * cards reads the backend's «напишите в поддержку» first.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  return NextResponse.json(await checkAccountDeletion());
}
