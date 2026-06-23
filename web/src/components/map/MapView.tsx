'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

import type { PublicEstablishmentMapMarker } from '@/lib/api/types';

/*
 * Interactive map island — Slice A: bare map + default markers.
 *
 * Loads the Yandex JS Maps API v3 (a different product from the Static API used
 * by MapPreview; the JS key is NEXT_PUBLIC_ by necessity, Referer-locked in the
 * cabinet). Mirrors the AuthProvider script pattern: <Script> + poll for the
 * global. Fetches establishments for the current viewport through the /api/map
 * Route Handler (server-only API_URL) and drops a default marker per pin.
 *
 * Custom brand markers, camera-driven refetch and tap-to-preview land in Slices
 * B–C; this slice proves the data + JS-API + key + Route-Handler path end to end.
 *
 * Client-only (window/ymaps3); rendered via a dynamic ssr:false import from the
 * ResultsSwitcher toggle, so the Yandex script loads only when the user opens
 * the map — never in the SSR/list path (the list stays the SEO surface).
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

const YMAPS_KEY = process.env.NEXT_PUBLIC_YANDEX_JS_API_KEY;
const YMAPS_SRC = `https://api-maps.yandex.ru/v3/?apikey=${YMAPS_KEY ?? ''}&lang=ru_RU`;

type LngLatBounds = [[number, number], [number, number]];

type YMapInstance = {
  addChild: (child: unknown) => void;
  destroy: () => void;
  bounds: LngLatBounds;
};

declare global {
  interface Window {
    // Minimal surface we use; ymaps3 ships no bundled types.
    ymaps3?: {
      ready: Promise<void>;
      YMap: new (
        el: HTMLElement,
        opts: { location: { center: [number, number]; zoom: number } },
      ) => YMapInstance;
      YMapDefaultSchemeLayer: new () => unknown;
      YMapDefaultFeaturesLayer: new () => unknown;
      YMapMarker: new (
        opts: { coordinates: [number, number] },
        el: HTMLElement,
      ) => unknown;
    };
  }
}

type Status = 'loading' | 'ready' | 'error';

export default function MapView({ citySlug }: { citySlug: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Initial status derives from key presence (a build-time NEXT_PUBLIC_ constant,
  // identical on server and client → no hydration mismatch), so the effect never
  // needs a synchronous setState for the missing-key case.
  const [status, setStatus] = useState<Status>(YMAPS_KEY ? 'loading' : 'error');
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!YMAPS_KEY) return;

    let cancelled = false;
    let map: YMapInstance | null = null;

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
          YMapMarker,
        } = ymaps3;

        map = new YMap(containerRef.current, {
          location: { center, zoom: DEFAULT_ZOOM },
        });
        map.addChild(new YMapDefaultSchemeLayer());
        map.addChild(new YMapDefaultFeaturesLayer());
        setStatus('ready');

        const markers = await fetchViewportMarkers(map, center);
        if (cancelled) return;
        setCount(markers.length);
        for (const m of markers) {
          if (m.latitude == null || m.longitude == null) continue;
          map.addChild(
            new YMapMarker({ coordinates: [m.longitude, m.latitude] }, makeDot()),
          );
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [citySlug]);

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

async function fetchViewportMarkers(
  map: YMapInstance,
  fallbackCenter: [number, number],
): Promise<PublicEstablishmentMapMarker[]> {
  const box = boxFromBounds(map.bounds) ?? boxAroundCenter(fallbackCenter);
  const qs = new URLSearchParams({
    swLat: String(box.swLat),
    neLat: String(box.neLat),
    swLon: String(box.swLon),
    neLon: String(box.neLon),
    limit: '200',
  });
  const res = await fetch(`/api/map?${qs.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    establishments?: PublicEstablishmentMapMarker[];
  };
  return data.establishments ?? [];
}

function boxFromBounds(bounds: LngLatBounds | undefined) {
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
  // Reject a degenerate (near-point) box: map.bounds is not laid out until the
  // map has rendered its viewport, but we read it synchronously right after
  // construction. Falling back to a city-area box keeps Slice A's initial load
  // meaningful; the camera-driven refetch (Slice B) reads bounds post-update.
  if (box.neLat - box.swLat < 0.005 || box.neLon - box.swLon < 0.005) {
    return null;
  }
  return box;
}

// Fallback box (~city metro span) if map.bounds is not ready at first paint.
function boxAroundCenter([lon, lat]: [number, number]) {
  return { swLon: lon - 0.35, neLon: lon + 0.35, swLat: lat - 0.2, neLat: lat + 0.2 };
}

function makeDot(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:14px;height:14px;border-radius:9999px;background:#E8622B;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transform:translate(-50%,-50%);';
  return el;
}

async function waitForYmaps3(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof window !== 'undefined' && window.ymaps3) return window.ymaps3;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return typeof window !== 'undefined' ? window.ymaps3 ?? null : null;
}
