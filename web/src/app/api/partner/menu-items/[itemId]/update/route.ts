import { NextResponse } from 'next/server';

import { checkName, checkPrice, checkSection, type MenuItemChanges } from '@/lib/partner/menu-format';
import { updateMenuItemAction } from '@/lib/partner/operations';
import { hasSessionCookie, readBodyText } from '@/lib/partner/request-body';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — edit one menu line (and «Всё верно»: the line sent back
 * as it is). Buffered POST Route Handler; the API's PATCH gets only the three
 * fields a partner may change, each of its own type and within the editor's
 * own checks (lib/partner/menu-format: the API checks none of them and answers
 * 500, or keeps an empty name the guests then see) — a request made outside
 * the editor is refused here with 400, nothing sent.
 *
 * Before the body is read (Phase 4.5, P2 3): a request without a session
 * cookie is refused (the API would refuse it anyway), and a body over
 * MAX_BODY_BYTES is not read further than that.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Three short fields: a body this long is not an edit of a menu line. */
const MAX_BODY_BYTES = 16 * 1024;

function changesOf(body: unknown): MenuItemChanges | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const changes: MenuItemChanges = {};
  if (typeof raw.item_name === 'string') {
    const name = checkName(raw.item_name);
    if (!name.ok) return null;
    changes.item_name = name.value;
  }
  if (raw.price_byn === null) {
    changes.price_byn = null;
  } else if (typeof raw.price_byn === 'number' && Number.isFinite(raw.price_byn)) {
    // The editor's own check, on the number as the editor would print it:
    // 0 … 99 999 999,99, two decimals at most.
    const price = checkPrice(String(raw.price_byn));
    if (!price.ok || price.value === null) return null;
    changes.price_byn = price.value;
  }
  if (typeof raw.category_raw === 'string') {
    const section = checkSection(raw.category_raw);
    if (!section.ok) return null;
    changes.category_raw = section.value;
  }
  return changes;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  if (!hasSessionCookie(request)) {
    return NextResponse.json({ ok: false, code: 'NO_SESSION' }, { status: 401 });
  }

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) {
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  let changes: MenuItemChanges | null;
  try {
    changes = changesOf(JSON.parse(text));
  } catch {
    changes = null;
  }
  if (!changes) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }

  const { itemId } = await ctx.params;
  return NextResponse.json(await updateMenuItemAction(itemId, changes));
}
