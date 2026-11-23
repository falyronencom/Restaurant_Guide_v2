import { NextResponse } from 'next/server';

import type { MenuItemChanges } from '@/lib/partner/menu-format';
import { updateMenuItemAction } from '@/lib/partner/operations';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * Partner cabinet — edit one menu line (and «Всё верно»: the line sent back
 * as it is). Buffered POST Route Handler; the API's PATCH gets only the three
 * fields a partner may change, each of its own type — nothing else of the
 * body is forwarded.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function changesOf(body: unknown): MenuItemChanges | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const changes: MenuItemChanges = {};
  if (typeof raw.item_name === 'string') changes.item_name = raw.item_name;
  if (raw.price_byn === null || (typeof raw.price_byn === 'number' && Number.isFinite(raw.price_byn))) {
    changes.price_byn = raw.price_byn;
  }
  if (typeof raw.category_raw === 'string') changes.category_raw = raw.category_raw;
  return changes;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const { itemId } = await ctx.params;

  let changes: MenuItemChanges | null;
  try {
    changes = changesOf(await request.json());
  } catch {
    changes = null;
  }
  if (!changes) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }

  return NextResponse.json(await updateMenuItemAction(itemId, changes));
}
