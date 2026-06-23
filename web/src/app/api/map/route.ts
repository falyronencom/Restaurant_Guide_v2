import { NextResponse } from 'next/server';

import { getMap, type MapParams } from '@/lib/api/endpoints/establishments';
import { ApiError } from '@/lib/api/types';

/*
 * Map markers proxy — browser fetch → Next route handler → server API client →
 * upstream public /establishments/map. Keeps API_URL server-only (getMap is
 * `import 'server-only'`) and avoids CORS. The interactive map island (client)
 * fetches this on camera move with the current viewport bounds + active filters.
 *
 * Mirror of api/establishments/route.ts. Always dynamic: every viewport is a
 * distinct bounds query, so response caching has no hit value. The map is a
 * client-only UX surface (not an SEO/indexed surface), and JSON over a Route
 * Handler is unaffected by the Railway edge streamed-RSC 503 issue.
 */

export const dynamic = 'force-dynamic';

/** Parse a finite numeric query param, or undefined when absent/blank/invalid. */
function num(sp: URLSearchParams, key: string): number | undefined {
  const raw = sp.get(key);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  const sp = new URL(request.url).searchParams;

  const params: MapParams = {
    city: sp.get('city') ?? undefined,
    category: sp.get('category') ?? undefined,
    cuisines: sp.get('cuisines')?.split(',').filter(Boolean),
    priceRange: sp.get('priceRange')?.split(',').filter(Boolean),
    minRating: num(sp, 'minRating'),
    hours_filter:
      (sp.get('hours_filter') as MapParams['hours_filter']) ?? undefined,
    search: sp.get('search') ?? undefined,
    limit: num(sp, 'limit'),
    neLat: num(sp, 'neLat'),
    neLon: num(sp, 'neLon'),
    swLat: num(sp, 'swLat'),
    swLon: num(sp, 'swLon'),
  };

  try {
    const data = await getMap(params);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { message: err.message, statusCode: err.statusCode } },
        {
          status:
            err.statusCode >= 400 && err.statusCode < 600
              ? err.statusCode
              : 500,
        },
      );
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
