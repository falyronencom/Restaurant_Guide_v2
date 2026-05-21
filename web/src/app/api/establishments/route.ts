import { NextResponse } from 'next/server';

import {
  getCatalog,
  type CatalogParams,
} from '@/lib/api/endpoints/establishments';
import { ApiError } from '@/lib/api/types';

/*
 * Thin passthrough route handler — scaffold for future client consumers.
 *
 * Brief 2 has no UI client consumers; this handler exists so the proxy
 * pattern is wired end-to-end (browser fetch → Next route handler → server
 * API client → upstream Railway). When Brief 3 introduces client-side
 * filtering/pagination, components consume this handler instead of the
 * upstream Railway endpoint directly — keeps API_URL server-only.
 *
 * Cache hint: ISR-ish (60s) — for foundation scaffolding only. Real cache
 * strategy (per-query, headers, ETag) belongs to Brief 3+.
 */

export const revalidate = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const sp = url.searchParams;

  const params: CatalogParams = {
    city: sp.get('city') ?? undefined,
    category: sp.get('category') ?? undefined,
    cuisines: sp.get('cuisines')?.split(',').filter(Boolean),
    priceRange: sp.get('priceRange')?.split(',').filter(Boolean),
    minRating: sp.get('minRating') ? Number(sp.get('minRating')) : undefined,
    search: sp.get('search') ?? undefined,
    sort_by: sp.get('sort_by') ?? undefined,
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
    page: sp.get('page') ? Number(sp.get('page')) : undefined,
  };

  try {
    const data = await getCatalog(params);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { message: err.message, statusCode: err.statusCode } },
        { status: err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500 },
      );
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
