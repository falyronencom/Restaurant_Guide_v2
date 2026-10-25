'use server';

import { revalidatePath } from 'next/cache';

import { getMenuItems } from '@/lib/api/endpoints/establishments';
import { currentVisitor } from '@/lib/api/visitor';
import type { PublicMenuItem } from '@/lib/api/types';
import { isDetailPathOf } from '@/lib/detail-path';

export type ReloadMenuResult =
  | { ok: true; menuItems: PublicMenuItem[] }
  | { ok: false };

/**
 * Re-fetch the detail page's text menu after the page's own fetch failed
 * (MenuLoadFailed calls it from the visitor's browser — the public API URL is
 * server-only, hence an action, not a client fetch). The reviews' pattern of
 * PR #81 (reloadReviewsAction), for the menu (сверка находок тестировщика с
 * сайтом, 18.10, Ш8).
 *
 * On success it also busts the literal detail path: the ISR page cached the
 * failed render (no menu in its HTML), and without this it would keep it for
 * up to an hour (revalidate = 3600). The path is only revalidated when it is a
 * detail address of THIS slug, so the action cannot be pointed at an
 * arbitrary route.
 */
export async function reloadMenuAction(input: {
  slug: string;
  detailPath: string;
}): Promise<ReloadMenuResult> {
  let result;
  try {
    // Any browser may call this action: it counts against its visitor, not
    // the site's own budget (lib/api/visitor.ts).
    result = await getMenuItems(input.slug, { visitor: await currentVisitor() });
  } catch {
    return { ok: false };
  }
  if (isDetailPathOf(input.detailPath, input.slug)) {
    revalidatePath(input.detailPath);
  }
  return { ok: true, menuItems: result.menu_items };
}
