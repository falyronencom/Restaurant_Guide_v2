'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

import {
  asFloat,
  asHours,
  asList,
  asString,
  type SearchParams,
} from '@/lib/catalog-params';
import type { PublicEstablishmentMapMarker } from '@/lib/api/types';

/*
 * Interactive map island — Slices A+B.
 *
 * Loads the Yandex JS Maps API v3 (JS key is NEXT_PUBLIC_ by necessity,
 * Referer-locked in the cabinet). Mirrors the AuthProvider script pattern:
 * <Script> + poll for the global. Renders custom brand markers (the web mirror
 * of the mobile canvas pin) and refetches establishments through the /api/map
 * Route Handler on camera move (debounced, with a viewport buffer), carrying the
 * catalog's active filters so list and map stay in sync.
 *
 * Client-only (window/ymaps3); rendered via a dynamic ssr:false import from the
 * ResultsSwitcher toggle, so the Yandex script loads only when the map opens.
 *
 * Deferred: open/closed marker state (needs working_hours on the marker
 * projection) and tap-to-preview + selected marker (Slice C); clustering for
 * dense city-wide zoom (Slice D). The `features` attribute facet is not honored
 * — searchByBounds (the bounds backend) does not accept it (known gap).
 */

// [lon, lat] — Yandex v3 takes longitude first.
const CITY_CENTERS: Record<string, [number, number]> = {
  minsk: [27.5615, 53.9023],
  brest: [23.6943, 52.0976],
  grodno: [23.8278, 53.6778],
  gomel: [31.0167, 52.4345],
  vitebsk: [30.2049, 55.1904],
  mogilev: [30.3331, 53.9007],
};
const DEFAULT_CENTER = CITY_CENTERS.minsk;
const DEFAULT_ZOOM = 12;
const VIEWPORT_BUFFER = 0.3; // fetch 30% beyond the viewport on each side
const REFETCH_DEBOUNCE_MS = 350;
const FETCH_LIMIT = 200;

const YMAPS_KEY = process.env.NEXT_PUBLIC_YANDEX_JS_API_KEY;
const YMAPS_SRC = `https://api-maps.yandex.ru/v3/?apikey=${YMAPS_KEY ?? ''}&lang=ru_RU`;

type LngLatBounds = [[number, number], [number, number]];
type Box = { swLat: number; neLat: number; swLon: number; neLon: number };
type Entity = unknown;

type YMapInstance = {
  addChild: (child: Entity) => void;
  removeChild: (child: Entity) => void;
  destroy: () => void;
  bounds: LngLatBounds;
};

type Ymaps3 = {
  ready: Promise<void>;
  YMap: new (
    el: HTMLElement,
    opts: { location: { center: [number, number]; zoom: number } },
  ) => YMapInstance;
  YMapDefaultSchemeLayer: new () => Entity;
  YMapDefaultFeaturesLayer: new () => Entity;
  YMapMarker: new (
    opts: { coordinates: [number, number] },
    el: HTMLElement,
  ) => Entity;
  YMapListener: new (opts: { onUpdate?: () => void }) => Entity;
};

declare global {
  interface Window {
    ymaps3?: Ymaps3;
  }
}

type MapFilters = {
  category?: string;
  cuisines?: string[];
  priceRange?: string[];
  minRating?: number;
  hours_filter?: 'until_22' | 'until_morning' | '24_hours';
  search?: string;
};

type Status = 'loading' | 'ready' | 'error';

export default function MapView({
  citySlug,
  categorySlug,
  searchParams,
}: {
  citySlug: string;
  categorySlug?: string;
  searchParams: SearchParams;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The map's refetch closure, published by the lifecycle effect so the
  // "filters changed" effect can re-run it without recreating the map.
  const refetchRef = useRef<(() => Promise<void>) | null>(null);
  const [status, setStatus] = useState<Status>(YMAPS_KEY ? 'loading' : 'error');
  const [count, setCount] = useState<number | null>(null);

  // Latest filters in a ref so the once-created camera listener reads current
  // values; a primitive key drives the refetch-on-change effect.
  const filters = buildFilters(categorySlug, searchParams);
  const filterKey = JSON.stringify(filters);
  const filtersRef = useRef(filters);

  // Map lifecycle — recreate only on city change (different centre).
  useEffect(() => {
    if (!YMAPS_KEY) return;

    let cancelled = false;
    let map: YMapInstance | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0; // request-sequence token — apply only the latest refetch

    void (async () => {
      const ymaps3 = await waitForYmaps3();
      if (cancelled) return;
      if (!ymaps3 || !containerRef.current) {
        setStatus('error');
        return;
      }
      try {
        await ymaps3.ready;
        if (cancelled || !containerRef.current) return;

        const center = CITY_CENTERS[citySlug] ?? DEFAULT_CENTER;
        const {
          YMap,
          YMapDefaultSchemeLayer,
          YMapDefaultFeaturesLayer,
          YMapListener,
        } = ymaps3;

        map = new YMap(containerRef.current, {
          location: { center, zoom: DEFAULT_ZOOM },
        });
        map.addChild(new YMapDefaultSchemeLayer());
        map.addChild(new YMapDefaultFeaturesLayer());

        const markers = new Map<string, Entity>();
        const refetch = async () => {
          if (cancelled || !map) return;
          const gen = ++generation;
          const raw = boxFromBounds(map.bounds) ?? boxAroundCenter(center);
          const box = bufferBox(raw, VIEWPORT_BUFFER);
          const data = await fetchMarkers(box, filtersRef.current);
          // Drop a stale response: a newer refetch (camera move or filter change)
          // superseded this one. Apply only the latest-issued result so the map
          // can't settle on an out-of-order earlier fetch (which would then
          // disagree with the server-rendered list).
          if (cancelled || !map || gen !== generation) return;
          setCount(syncMarkers(map, ymaps3, markers, data));
        };

        map.addChild(
          new YMapListener({
            onUpdate: () => {
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => void refetch(), REFETCH_DEBOUNCE_MS);
            },
          }),
        );

        refetchRef.current = refetch;
        setStatus('ready');
        await refetch(); // immediate pins; camera onUpdate refines on layout
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
      refetchRef.current = null;
      map?.destroy();
    };
  }, [citySlug]);

  // Filters changed → publish latest filters to the ref and refetch (no map
  // recreation). filterKey is the value-stable serialization of `filters`;
  // depending on the object itself would re-run every render (server
  // searchParams is a fresh ref each time).
  useEffect(() => {
    filtersRef.current = filters;
    void refetchRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return (
    <>
      {YMAPS_KEY && <Script src={YMAPS_SRC} strategy="afterInteractive" />}
      <div className="relative h-[70vh] w-full overflow-hidden rounded-card bg-muted">
        <div ref={containerRef} className="absolute inset-0" />
        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center text-body-m text-muted-foreground">
            Загрузка карты…
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center px-m text-center text-body-m text-muted-foreground">
            Не удалось загрузить карту. Обновите страницу.
          </div>
        )}
        {status === 'ready' && count != null && (
          <div className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-caption-l text-foreground shadow">
            Заведений на карте: {count}
          </div>
        )}
      </div>
    </>
  );
}

function buildFilters(
  categorySlug: string | undefined,
  sp: SearchParams = {},
): MapFilters {
  // Mirror the catalog's param parsing exactly (same helpers) so list and map
  // agree. `features` is intentionally omitted — the bounds backend lacks it.
  return {
    category: categorySlug,
    cuisines: asList(sp.cuisine),
    priceRange: asList(sp.priceRange),
    minRating: asFloat(sp.minRating),
    hours_filter: asHours(sp.hours),
    search: asString(sp.search),
  };
}

async function fetchMarkers(
  box: Box,
  filters: MapFilters,
): Promise<PublicEstablishmentMapMarker[]> {
  const qs = new URLSearchParams({
    swLat: String(box.swLat),
    neLat: String(box.neLat),
    swLon: String(box.swLon),
    neLon: String(box.neLon),
    limit: String(FETCH_LIMIT),
  });
  if (filters.category) qs.set('category', filters.category);
  if (filters.cuisines?.length) qs.set('cuisines', filters.cuisines.join(','));
  if (filters.priceRange?.length)
    qs.set('priceRange', filters.priceRange.join(','));
  if (filters.minRating != null) qs.set('minRating', String(filters.minRating));
  if (filters.hours_filter) qs.set('hours_filter', filters.hours_filter);
  if (filters.search) qs.set('search', filters.search);

  const res = await fetch(`/api/map?${qs.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    establishments?: PublicEstablishmentMapMarker[];
  };
  return data.establishments ?? [];
}

// Add/remove markers by id against the live set so unchanged pins never flicker
// on refetch. Returns the count currently shown.
function syncMarkers(
  map: YMapInstance,
  ymaps3: Ymaps3,
  markers: Map<string, Entity>,
  data: PublicEstablishmentMapMarker[],
): number {
  const next = new Map(
    data
      .filter((m) => m.latitude != null && m.longitude != null)
      .map((m) => [m.id, m] as const),
  );

  for (const [id, marker] of markers) {
    if (!next.has(id)) {
      map.removeChild(marker);
      markers.delete(id);
    }
  }

  const { YMapMarker } = ymaps3;
  for (const [id, m] of next) {
    if (!markers.has(id)) {
      const marker = new YMapMarker(
        { coordinates: [m.longitude as number, m.latitude as number] },
        makeBrandPin(),
      );
      map.addChild(marker);
      markers.set(id, marker);
    }
  }

  return next.size;
}

// Web mirror of the mobile canvas pin (mobile/lib/widgets/map/map_marker_painter)
// and the static-map MapBrandPin: brand-orange teardrop, white border, white
// fork-and-knife. Tip anchored at the bottom-centre via translate(-50%,-100%).
function makeBrandPin(variant: 'default' | 'selected' = 'default'): HTMLElement {
  const fill = variant === 'selected' ? '#F2B600' : '#E8622B';
  const el = document.createElement('div');
  el.style.cssText =
    'width:40px;height:48px;transform:translate(-50%,-100%);cursor:pointer;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));';
  el.innerHTML =
    '<svg width="40" height="48" viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">' +
    `<path d="M20 2C12.27 2 6 8.27 6 16c0 10.5 14 28 14 28s14-17.5 14-28C34 8.27 27.73 2 20 2z" fill="${fill}" stroke="#fff" stroke-width="3"/>` +
    '<g transform="translate(11.5 7.5) scale(0.71)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>' +
    '</g></svg>';
  return el;
}

function boxFromBounds(bounds: LngLatBounds | undefined): Box | null {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const lngs = [bounds[0][0], bounds[1][0]];
  const lats = [bounds[0][1], bounds[1][1]];
  if ([...lngs, ...lats].some((n) => !Number.isFinite(n))) return null;
  const box = {
    swLon: Math.min(...lngs),
    neLon: Math.max(...lngs),
    swLat: Math.min(...lats),
    neLat: Math.max(...lats),
  };
  // Reject a degenerate (near-point) box: map.bounds is a near-point until the
  // map has laid out its viewport — true for the synchronous initial read, but
  // the camera onUpdate fires post-layout with a real box.
  if (box.neLat - box.swLat < 0.005 || box.neLon - box.swLon < 0.005) {
    return null;
  }
  return box;
}

// Fallback box (~city metro span) for the initial read before the map lays out.
function boxAroundCenter([lon, lat]: [number, number]): Box {
  return { swLon: lon - 0.35, neLon: lon + 0.35, swLat: lat - 0.2, neLat: lat + 0.2 };
}

function bufferBox(box: Box, frac: number): Box {
  const latPad = (box.neLat - box.swLat) * frac;
  const lonPad = (box.neLon - box.swLon) * frac;
  return {
    swLat: box.swLat - latPad,
    neLat: box.neLat + latPad,
    swLon: box.swLon - lonPad,
    neLon: box.neLon + lonPad,
  };
}

async function waitForYmaps3(timeoutMs = 8000): Promise<Ymaps3 | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof window !== 'undefined' && window.ymaps3) return window.ymaps3;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return typeof window !== 'undefined' ? window.ymaps3 ?? null : null;
}
