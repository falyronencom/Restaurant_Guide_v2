import { NextResponse } from 'next/server';

import { getMap, type MapParams } from '@/lib/api/endpoints/establishments';
import { getMetadata } from '@/lib/api/endpoints/metadata';
import {
  ApiError,
  type PublicEstablishmentMapMarker,
  type PublicMetadata,
} from '@/lib/api/types';
import { getPhraseMapMarkers } from '@/lib/smart-search';

/*
 * Map markers proxy — browser fetch → Next route handler → server API client →
 * upstream public /establishments/map. Keeps API_URL server-only (getMap is
 * `import 'server-only'`) and avoids CORS. The interactive map island (client)
 * fetches this on camera move with the current viewport bounds + active filters.
 *
 * With a search phrase the map shows what the list shows: the phrase's whole
 * smart-search result set (getPhraseMapMarkers), not a viewport box — the list
 * above it is answered by the smart endpoint too, and the classic text search
 * would put 0 pins under a list of 19 («терраса»). The island sends `city` and
 * `features` only with a phrase (the smart endpoint needs the city; the bounds
 * backend has no amenity facet) and does not re-query on camera moves then.
 * If the phrase cannot take the smart path, the classic map answers — without
 * the viewport box, so the pins still do not depend on where the camera is.
 *
 * Mirror of api/establishments/route.ts. Always dynamic: every viewport is a
 * distinct bounds query, so response caching has no hit value. The map is a
 * client-only UX surface (not an SEO/indexed surface), and JSON over a Route
 * Handler is unaffected by the Railway edge streamed-RSC 503 issue.
 */

export const dynamic = 'force-dynamic';

/**
 * The phrase map's markers, or null → the classic map. Metadata (the slug →
 * Cyrillic map the smart body needs) is fetched only on this path, so its
 * failure falls back like a smart failure instead of costing the map its pins.
 */
async function phraseMarkers(
  params: MapParams,
  features: string[] | undefined,
): Promise<PublicEstablishmentMapMarker[] | null> {
  let meta: PublicMetadata;
  try {
    meta = await getMetadata();
  } catch {
    return null;
  }
  return getPhraseMapMarkers(
    {
      city: params.city,
      category: params.category,
      cuisines: params.cuisines,
      priceRange: params.priceRange,
      features,
      minRating: params.minRating,
      hours_filter: params.hours_filter,
      search: params.search,
    },
    meta,
  );
}

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
    if (params.search?.trim()) {
      const markers = await phraseMarkers(
        params,
        sp.get('features')?.split(',').filter(Boolean),
      );
      if (markers) return NextResponse.json({ establishments: markers });
      const data = await getMap({
        ...params,
        neLat: undefined,
        neLon: undefined,
        swLat: undefined,
        swLon: undefined,
      });
      return NextResponse.json(data);
    }

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
