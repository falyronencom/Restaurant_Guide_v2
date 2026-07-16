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
import { cn } from '@/lib/utils';

import { MapPreviewCard } from './MapPreviewCard';

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
 * Slice D part 1 — deep-link focus: a ?focus=<slug>&flat=<lat>&flng=<lng> query
 * (from an establishment card's MapPreview) centres the map on that point and
 * auto-selects its pin once the viewport's markers load, keeping the user inside
 * our funnel instead of bouncing to external Yandex Maps.
 *
 * Slice D part 2 — clustering: at city-wide zoom the real seed puts ~257 pins in
 * the Minsk viewport, which is both unreadable and heavy. Markers are handed to
 * Yandex's own clusterer (@yandex/ymaps3-clusterer), which groups them into
 * brand bubbles and re-clusters on camera move without a refetch. It is a
 * bundled npm dependency pulled in by a dynamic import from OUR origin — not
 * ymaps3.import, which has no loader for it; see the block at the import site.
 * Its entity cache keys a lone point by our own establishment id, so an
 * unchanged pin survives a refetch as the same DOM node (no flicker; the
 * hover/committed element refs stay valid). If the module fails to load we fall
 * back to the pre-clustering path: every marker rendered flat.
 *
 * Deferred: open/closed marker state (needs working_hours on the marker
 * projection); spiderfy for coincident coordinates. The `features` attribute
 * facet is not honored — searchByBounds (the bounds backend) does not accept it
 * (known gap).
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
const FOCUS_ZOOM = 15; // street-level when deep-linked to one establishment
const VIEWPORT_BUFFER = 0.3; // fetch 30% beyond the viewport on each side
const REFETCH_DEBOUNCE_MS = 350;
// Covers the whole launch-horizon seed (~500-600 cards) in one viewport read:
// at 200 the Minsk city view silently truncated (~257 active cards inside the
// bbox), leaving 57+ establishments off the map at any zoom. 500 is exactly the
// backend's clamp ceiling (publicService: min(max(limit,1),500)); a denser
// Minsk (5000+) is a post-launch problem needing server-side clustering.
const FETCH_LIMIT = 500;

// Clustering. gridSize is in screen pixels — 64 is the module default and keeps
// bubbles from touching, given the 40px-wide pin.
const CLUSTER_GRID_SIZE = 64;
// Above this zoom the clusterer renders every point as its own marker. Deep-link
// focus lands at FOCUS_ZOOM (15), so the anchored establishment is always an
// individual pin by construction — never swallowed by a bubble.
const CLUSTER_MAX_ZOOM = 14;
// Floor for a cluster's zoom-to-contents span (~150m). Coincident coordinates
// give a zero-extent box, which is not a usable camera target.
const CLUSTER_MIN_SPAN = 0.0015;
// Below this a viewport rectangle is collapsed, not merely small: ~0.1mm, five
// orders of magnitude under the smallest viewport a live map can report (max
// zoom, ~2e-4 — see boxFromBounds). Exists to absorb float noise around an
// exactly-zero extent, NOT as a "too small to be real" heuristic — that is
// unimplementable here, and attempting it is what broke deep zoom.
const DEGENERATE_SPAN = 1e-9;
// Debounce hiding the desktop hover preview so the cursor crossing the gap
// between two adjacent pins doesn't make the card flicker.
const HOVER_HIDE_MS = 120;
// Pin fills: brand orange at rest, brand yellow when highlighted (the committed
// selection or the transient hover).
const FILL_DEFAULT = '#E8622B';
const FILL_HIGHLIGHT = '#F2B600';

const YMAPS_KEY = process.env.NEXT_PUBLIC_YANDEX_JS_API_KEY;
const YMAPS_SRC = `https://api-maps.yandex.ru/v3/?apikey=${YMAPS_KEY ?? ''}&lang=ru_RU`;

type LngLat = [number, number];
type LngLatBounds = [LngLat, LngLat];
type Box = { swLat: number; neLat: number; swLon: number; neLon: number };
type Entity = unknown;

type YMapInstance = {
  addChild: (child: Entity) => void;
  removeChild: (child: Entity) => void;
  destroy: () => void;
  // `location` accepts duration/easing per ymaps3's types, but pairing either
  // with `bounds` makes the whole update a no-op at runtime. We only ever send
  // bounds, so the animation fields are deliberately absent from this contract.
  update: (opts: { location: { bounds: LngLatBounds } }) => void;
  bounds: LngLatBounds;
};

/*
 * Clusterer contract, transcribed from the installed package's own declarations
 * (@yandex/ymaps3-clusterer@0.0.12 dist/types). We restate it instead of using
 * those types directly: they import from `@yandex/ymaps3-types`, a types-only
 * package we deliberately do not install (it would drag react/vue peer deps in
 * for nothing). Under skipLibCheck those imports silently degrade to `any`, so
 * this local contract is what actually holds the seam.
 */
type ClusterFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: LngLat };
};

type ClusterMethod = { render: unknown };

type ClustererEntity = Entity & {
  update: (props: { features: ClusterFeature[] }) => void;
};

type ClustererModule = {
  YMapClusterer: new (props: {
    method: ClusterMethod;
    features: ClusterFeature[];
    marker: (feature: ClusterFeature) => Entity;
    cluster: (coordinates: LngLat, features: ClusterFeature[]) => Entity;
    tickTimeout?: number;
    maxZoom?: number;
  }) => ClustererEntity;
  clusterByGrid: (opts: { gridSize: number }) => ClusterMethod;
};

type Ymaps3 = {
  ready: Promise<void>;
  YMap: new (
    el: HTMLElement,
    opts: { location: { center: LngLat; zoom: number } },
  ) => YMapInstance;
  YMapDefaultSchemeLayer: new () => Entity;
  YMapDefaultFeaturesLayer: new () => Entity;
  YMapMarker: new (opts: { coordinates: LngLat }, el: HTMLElement) => Entity;
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
type DataStatus = 'idle' | 'fetching' | 'error';

export default function MapView({
  citySlug,
  categorySlug,
  searchParams,
  className,
}: {
  citySlug: string;
  categorySlug?: string;
  searchParams: SearchParams;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The map's refetch closure, published by the lifecycle effect so the
  // "filters changed" effect can re-run it without recreating the map.
  const refetchRef = useRef<(() => Promise<void>) | null>(null);
  // Clears the tapped pin + card; published by the lifecycle effect so the
  // card's close button can reach the imperative pin de-highlight.
  const clearSelectionRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<Status>(YMAPS_KEY ? 'loading' : 'error');
  // Data-fetch state for a ready map: separates a genuine empty result
  // (count === 0) from a refetch failure, and drives the refetch-in-flight
  // indicator. Only the latest-issued refetch writes it (generation guard).
  const [dataStatus, setDataStatus] = useState<DataStatus>('idle');
  const [count, setCount] = useState<number | null>(null);
  // Bumped by the "retry" control after a map-init failure; recreates the map
  // by re-running the lifecycle effect.
  const [retryToken, setRetryToken] = useState(0);
  const [selected, setSelected] = useState<PublicEstablishmentMapMarker | null>(
    null,
  );

  // Latest filters in a ref so the once-created camera listener reads current
  // values; a primitive key drives the refetch-on-change effect.
  const filters = buildFilters(categorySlug, searchParams);
  const filterKey = JSON.stringify(filters);
  const filtersRef = useRef(filters);
  // Tunes the empty-state hint: only suggest "change filters" when a facet is
  // actually narrowing the result (the establishment overlay passes none).
  const hasActiveFilters = Boolean(
    filters.cuisines?.length ||
      filters.priceRange?.length ||
      filters.minRating != null ||
      filters.hours_filter ||
      filters.search,
  );

  // Deep-link focus (Slice D part 1). Coordinates centre the map immediately;
  // the slug matches a marker once the viewport loads → auto-select its pin.
  //
  // The slug is honoured ONLY together with coordinates, and that coupling is
  // load-bearing under clustering: auto-select fires when the anchor's own pin
  // is built, which only happens if the anchor is not inside a bubble. The
  // centring zoom (FOCUS_ZOOM) is what pushes past CLUSTER_MAX_ZOOM and
  // guarantees that. A slug arriving without coordinates would open at
  // DEFAULT_ZOOM, where the anchor is clustered and its pin never built — so
  // treat that URL as having no focus at all rather than silently arming an
  // anchor that can never resolve. Every producer emits all three together
  // (see EstablishmentMapOverlay).
  const focusLat = asFloat(searchParams.flat);
  const focusLng = asFloat(searchParams.flng);
  const hasFocusCenter = focusLat != null && focusLng != null;
  const focusSlug = hasFocusCenter ? asString(searchParams.focus) : undefined;

  // Map lifecycle — recreate on city OR focus change (different centre).
  useEffect(() => {
    if (!YMAPS_KEY) return;

    const container = containerRef.current;
    let cancelled = false;
    let map: YMapInstance | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0; // request-sequence token — apply only the latest refetch

    // Tap on the map backdrop (not a pin) clears the selection. Pins
    // stopPropagation their own click, so a pin tap never bubbles to the
    // container — only a backdrop tap does.
    const onContainerClick = () => clearSelectionRef.current?.();

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

        const center: LngLat = hasFocusCenter
          ? [focusLng, focusLat]
          : CITY_CENTERS[citySlug] ?? DEFAULT_CENTER;
        const zoom = hasFocusCenter ? FOCUS_ZOOM : DEFAULT_ZOOM;
        const {
          YMap,
          YMapDefaultSchemeLayer,
          YMapDefaultFeaturesLayer,
          YMapListener,
        } = ymaps3;

        map = new YMap(containerRef.current, {
          location: { center, zoom },
        });
        map.addChild(new YMapDefaultSchemeLayer());
        map.addChild(new YMapDefaultFeaturesLayer());

        // Flat-render bookkeeping — only used on the no-clusterer fallback path.
        const markers = new Map<string, Entity>();
        // Latest marker data by id. A pin's DOM node outlives the refetch that
        // replaced its data (both the clusterer's entity cache and the flat
        // path's id-diff reuse it), so handlers must read the establishment at
        // event time instead of closing over the one present at creation.
        const dataById = new Map<string, PublicEstablishmentMapMarker>();

        // Desktop (a fine pointer that can hover — a mouse) gets Booking-style
        // hover preview + click-to-open; touch keeps tap-to-preview. Mirror of
        // SmartLink's capability gate.
        const isDesktopHover = window.matchMedia(
          '(pointer: fine) and (hover: hover)',
        ).matches;

        // Pin paint: a single highlight shared by the committed selection and
        // the transient hover; default otherwise. The card shows the hovered
        // marker if any, else the committed one.
        const paint = (el: HTMLElement, fill: string) =>
          el.querySelector('path')?.setAttribute('fill', fill);

        // Committed = a persisted selection: a touch tap, or the deep-link
        // anchor (Slice D). Hovered = the transient desktop hover.
        let committedEl: HTMLElement | null = null;
        let committedMarker: PublicEstablishmentMapMarker | null = null;
        let hoveredEl: HTMLElement | null = null;
        let hideTimer: ReturnType<typeof setTimeout> | undefined;
        const restFill = (el: HTMLElement) =>
          el === committedEl ? FILL_HIGHLIGHT : FILL_DEFAULT;

        // Touch tap / deep-link anchor → persist the selection + show its card.
        const commitSelection = (
          m: PublicEstablishmentMapMarker,
          el: HTMLElement,
        ) => {
          if (committedEl && committedEl !== el) paint(committedEl, FILL_DEFAULT);
          committedEl = el;
          committedMarker = m;
          paint(el, FILL_HIGHLIGHT);
          setSelected(m);
        };

        // Desktop hover → transient preview; does not persist.
        const onMarkerEnter = (
          m: PublicEstablishmentMapMarker,
          el: HTMLElement,
        ) => {
          clearTimeout(hideTimer);
          if (hoveredEl && hoveredEl !== el) paint(hoveredEl, restFill(hoveredEl));
          hoveredEl = el;
          paint(el, FILL_HIGHLIGHT);
          setSelected(m);
        };
        const onMarkerLeave = (el: HTMLElement) => {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            if (hoveredEl === el) {
              paint(el, restFill(el));
              hoveredEl = null;
            }
            // Fall back to the committed selection (the anchor) or clear.
            setSelected(committedMarker);
          }, HOVER_HIDE_MS);
        };

        // Desktop click → straight to the detail page in a new tab (mirror
        // SmartLink / D-2B); hover already gives the preview, so no persist.
        const onMarkerActivate = (m: PublicEstablishmentMapMarker) =>
          window.open(
            detailHref(m, citySlug, categorySlug),
            '_blank',
            'noopener,noreferrer',
          );

        clearSelectionRef.current = () => {
          clearTimeout(hideTimer);
          if (committedEl) paint(committedEl, FILL_DEFAULT);
          if (hoveredEl && hoveredEl !== committedEl) {
            paint(hoveredEl, FILL_DEFAULT);
          }
          committedEl = null;
          committedMarker = null;
          hoveredEl = null;
          setSelected(null);
        };

        // Deep-link auto-select fires once, when the focused slug's pin is first
        // created: centring guarantees it is in the first viewport, and
        // CLUSTER_MAX_ZOOM < FOCUS_ZOOM guarantees it renders as its own pin
        // rather than being swallowed into a bubble.
        let autoFocusDone = false;

        // The one place a pin is built — used by the clusterer's `marker`
        // callback and by the flat fallback, so both render the identical
        // brand pin with identical behaviour.
        const makePinEntity = (id: string, coordinates: LngLat): Entity => {
          const el = makeBrandPin();
          const current = () => dataById.get(id);
          if (isDesktopHover) {
            el.addEventListener('mouseenter', () => {
              const m = current();
              if (m) onMarkerEnter(m, el);
            });
            el.addEventListener('mouseleave', () => onMarkerLeave(el));
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              const m = current();
              if (m) onMarkerActivate(m);
            });
          } else {
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              const m = current();
              if (m) commitSelection(m, el);
            });
          }
          const m = current();
          if (m && focusSlug && !autoFocusDone && m.slug === focusSlug) {
            commitSelection(m, el);
            autoFocusDone = true;
          }
          return new ymaps3.YMapMarker({ coordinates }, el);
        };

        // Brand bubble for a group: click zooms to the group's own extent, hover
        // does nothing (a preview belongs to a single establishment).
        const makeBubbleEntity = (
          coordinates: LngLat,
          features: ClusterFeature[],
        ): Entity => {
          const el = makeClusterBubble(features.length);
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const bounds = boundsOfFeatures(features);
            // No duration/easing here, deliberately: ymaps3 accepts the combo in
            // its types but silently drops a `bounds` location when either is
            // present — the camera simply never moves. Animating a zoom-to-extent
            // means converting it to center+zoom by hand; an instant jump is what
            // the interaction needs anyway. Verified against a live map.
            if (bounds && map) map.update({ location: { bounds } });
          });
          return new ymaps3.YMapMarker({ coordinates }, el);
        };

        /*
         * The clusterer is a bundled npm dependency loaded through a dynamic
         * import — NOT through ymaps3.import. The documented ymaps3.import path
         * carries no loader for this package (`ymaps3.import.loaders` is empty;
         * it fails with "no loader for pkg"), and registering one means pointing
         * ymaps3 at a third-party CDN. The package is a self-contained bundle
         * whose only external reference is the `ymaps3` global, so importing it
         * here — after `ymaps3.ready` — satisfies it while keeping the code on
         * our own origin. Deferring the import to this point is load-bearing:
         * the module reads the global as it evaluates.
         *
         * A failure must not cost us the pins: fall back to the flat render
         * (what shipped before clustering) instead of an empty map.
         */
        // The map itself is built and interactive by now; only the grouping of
        // pins waits on the chunk. Clearing 'loading' here keeps the overlay
        // from covering a working map for the download's duration — nothing is
        // rendered into it until the refetch below either way.
        setStatus('ready');
        let clusterer: ClustererEntity | null = null;
        try {
          const { YMapClusterer, clusterByGrid } = (await import(
            '@yandex/ymaps3-clusterer'
          )) as unknown as ClustererModule;
          if (cancelled || !map) return;
          clusterer = new YMapClusterer({
            method: clusterByGrid({ gridSize: CLUSTER_GRID_SIZE }),
            features: [],
            marker: (f) => makePinEntity(f.id, f.geometry.coordinates),
            cluster: makeBubbleEntity,
            maxZoom: CLUSTER_MAX_ZOOM,
          });
          map.addChild(clusterer);
        } catch {
          clusterer = null;
        }

        // Publish a viewport's data. Returns the establishment count — never a
        // bubble count: the badge speaks in places, not in groups.
        const applyData = (data: PublicEstablishmentMapMarker[]): number => {
          // Refresh the lookup before rendering so a newly built pin's handlers
          // resolve against this response, not the previous one.
          dataById.clear();
          for (const m of data) dataById.set(m.id, m);
          const features = toClusterFeatures(data);
          if (clusterer) {
            clusterer.update({ features });
          } else if (map) {
            syncMarkers(map, markers, features, makePinEntity);
          }
          return features.length;
        };

        const refetch = async () => {
          if (cancelled || !map) return;
          const gen = ++generation;
          setDataStatus('fetching');
          const raw = boxFromBounds(map.bounds) ?? boxAroundCenter(center);
          const box = bufferBox(raw, VIEWPORT_BUFFER);
          try {
            const data = await fetchMarkers(box, filtersRef.current);
            // Drop a stale response: a newer refetch (camera move or filter
            // change) superseded this one. Apply only the latest-issued result
            // so the map can't settle on an out-of-order earlier fetch (which
            // would then disagree with the server-rendered list).
            if (cancelled || !map || gen !== generation) return;
            setCount(applyData(data));
            setDataStatus('idle');
          } catch {
            // Same generation guard: a stale failure must not overwrite a
            // fresher result — only the latest refetch may surface an error.
            if (cancelled || !map || gen !== generation) return;
            setDataStatus('error');
          }
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
        container?.addEventListener('click', onContainerClick);
        await refetch(); // immediate pins; camera onUpdate refines on layout
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
      container?.removeEventListener('click', onContainerClick);
      refetchRef.current = null;
      clearSelectionRef.current = null;
      map?.destroy();
    };
    // hasFocusCenter is derived from focusLat/focusLng, so listing it adds no
    // re-runs beyond theirs — it is here to keep the dep list honest.
  }, [
    citySlug,
    categorySlug,
    focusSlug,
    focusLat,
    focusLng,
    hasFocusCenter,
    retryToken,
  ]);

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
      <div
        className={cn(
          'relative h-[70vh] w-full overflow-hidden rounded-card bg-muted',
          className,
        )}
      >
        <div ref={containerRef} className="absolute inset-0" />

        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center text-body-m text-muted-foreground">
            Загрузка карты…
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center px-m text-center">
            <div className="flex flex-col items-center gap-3 text-body-m text-muted-foreground">
              <span>Не удалось загрузить карту.</span>
              {YMAPS_KEY && (
                <button
                  type="button"
                  onClick={() => {
                    setStatus('loading');
                    setRetryToken((t) => t + 1);
                  }}
                  className="rounded-full bg-brand px-4 py-1.5 text-caption-l font-medium text-white"
                >
                  Повторить
                </button>
              )}
            </div>
          </div>
        )}

        {/* Status badge / refetch indicator (top-left); hidden on empty + error,
            which surface their own centred panel. */}
        {status === 'ready' &&
          (dataStatus === 'fetching' ||
            (dataStatus === 'idle' && (count ?? 0) > 0)) && (
            <div className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-caption-l text-foreground shadow">
              {dataStatus === 'fetching' ? (
                <span className="flex items-center gap-2">
                  <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  Обновление…
                </span>
              ) : (
                `Заведений на карте: ${count}`
              )}
            </div>
          )}

        {/* Refetch failed — kept distinct from a genuine empty result. */}
        {status === 'ready' && dataStatus === 'error' && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-m">
            <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-card bg-white/95 px-5 py-4 text-center shadow-lg">
              <span className="text-body-m text-foreground">
                Не удалось обновить карту
              </span>
              <button
                type="button"
                onClick={() => void refetchRef.current?.()}
                className="rounded-full bg-brand px-4 py-1.5 text-caption-l font-medium text-white"
              >
                Повторить
              </button>
            </div>
          </div>
        )}

        {/* Genuine empty viewport (after filters), not an error. */}
        {status === 'ready' && dataStatus === 'idle' && count === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-m">
            <div className="pointer-events-auto max-w-[16rem] rounded-card bg-white/95 px-5 py-4 text-center shadow-lg">
              <p className="text-body-m text-foreground">
                В этой области ничего не найдено
              </p>
              <p className="mt-1 text-body-s text-muted-foreground">
                {hasActiveFilters
                  ? 'Измените фильтры или сместите карту'
                  : 'Сместите или приблизьте карту'}
              </p>
            </div>
          </div>
        )}

        {selected && (
          <MapPreviewCard
            marker={selected}
            fallbackCitySlug={citySlug}
            fallbackCategorySlug={categorySlug ?? 'restaurants'}
            onClose={() => clearSelectionRef.current?.()}
          />
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

// Detail href for a marker — mirror MapPreviewCard / EstablishmentCard: the
// establishment's own city/category slug, falling back to the current map
// page's slugs when the projection is null (category_slug is null outside the
// slug canon).
function detailHref(
  m: PublicEstablishmentMapMarker,
  fallbackCitySlug: string,
  fallbackCategorySlug?: string,
): string {
  const citySlug = m.city_slug ?? fallbackCitySlug;
  const categorySlug = m.category_slug ?? fallbackCategorySlug ?? 'restaurants';
  return `/${citySlug}/${categorySlug}/${m.slug}`;
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
  // Throw (not return []) so the caller can tell a fetch failure apart from a
  // genuine empty viewport: the former drives the error panel + retry, the
  // latter the "nothing here" empty state. A network failure rejects already.
  if (!res.ok) throw new Error(`Map fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    establishments?: PublicEstablishmentMapMarker[];
  };
  return data.establishments ?? [];
}

/*
 * Marker projection → clusterer input. Drops rows the map cannot place (the
 * projection allows null coordinates), so the returned length is also the
 * "establishments on the map" count. Coordinates are [lng, lat] — Yandex takes
 * longitude first.
 */
export function toClusterFeatures(
  data: PublicEstablishmentMapMarker[],
): ClusterFeature[] {
  const features: ClusterFeature[] = [];
  for (const m of data) {
    if (m.latitude == null || m.longitude == null) continue;
    features.push({
      type: 'Feature',
      id: m.id,
      geometry: { type: 'Point', coordinates: [m.longitude, m.latitude] },
    });
  }
  return features;
}

/*
 * Bubble size steps by member count. Deliberately coarse — the number inside is
 * the information, the size is only a hint at magnitude.
 */
export function bubbleTier(count: number): { size: number; font: number } {
  if (count < 10) return { size: 36, font: 13 };
  if (count < 50) return { size: 46, font: 15 };
  return { size: 58, font: 17 };
}

/*
 * Extent of a cluster's members, as the camera target for a bubble click.
 *
 * Corner order is [top-left, bottom-right] — i.e. NORTH latitude first — per
 * ymaps3's own `LngLatBounds` ("Rectangle bounded by top-left and bottom-right
 * coordinates"). Handing it a south-first rectangle does not throw: the camera
 * silently treats the inverted box as degenerate and slams to max zoom.
 *
 * Coincident members give a zero-extent box, which is not a usable target
 * either, so every span is floored at CLUSTER_MIN_SPAN around its own midpoint.
 */
export function boundsOfFeatures(
  features: ClusterFeature[],
  minSpan: number = CLUSTER_MIN_SPAN,
): LngLatBounds | null {
  if (features.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  const pad = (min: number, max: number): [number, number] => {
    if (max - min >= minSpan) return [min, max];
    const mid = (min + max) / 2;
    return [mid - minSpan / 2, mid + minSpan / 2];
  };
  const [west, east] = pad(minLng, maxLng);
  const [south, north] = pad(minLat, maxLat);
  return [
    [west, north],
    [east, south],
  ];
}

// Flat render — the no-clusterer fallback. Adds/removes by id against the live
// set so unchanged pins never flicker on refetch.
function syncMarkers(
  map: YMapInstance,
  markers: Map<string, Entity>,
  features: ClusterFeature[],
  makePin: (id: string, coordinates: LngLat) => Entity,
): void {
  const next = new Map(features.map((f) => [f.id, f] as const));

  for (const [id, marker] of markers) {
    if (!next.has(id)) {
      map.removeChild(marker);
      markers.delete(id);
    }
  }

  for (const [id, f] of next) {
    if (!markers.has(id)) {
      const marker = makePin(id, f.geometry.coordinates);
      map.addChild(marker);
      markers.set(id, marker);
    }
  }
}

// Web mirror of the mobile canvas pin (mobile/lib/widgets/map/map_marker_painter)
// and the static-map MapBrandPin: brand-orange teardrop, white border, white
// fork-and-knife. Tip anchored at the bottom-centre via translate(-50%,-100%).
function makeBrandPin(variant: 'default' | 'selected' = 'default'): HTMLElement {
  const fill = variant === 'selected' ? '#F2B600' : '#E8622B';
  const el = document.createElement('div');
  el.style.cssText =
    'width:40px;height:48px;transform:translate(-50%,-100%);cursor:pointer;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));';
  // pointer-events:none on the SVG makes the solid 40×48 div the single hit
  // target. Without it, hits land on painted SVG shapes only — the fork/knife
  // glyph is fill="none", so its gaps let a click on the pin's centre fall
  // through; the rim (filled teardrop) registered but the centre felt "dead".
  el.innerHTML =
    '<svg width="40" height="48" viewBox="0 0 40 48" style="display:block;pointer-events:none" xmlns="http://www.w3.org/2000/svg">' +
    `<path d="M20 2C12.27 2 6 8.27 6 16c0 10.5 14 28 14 28s14-17.5 14-28C34 8.27 27.73 2 20 2z" fill="${fill}" stroke="#fff" stroke-width="3"/>` +
    '<g transform="translate(11.5 7.5) scale(0.71)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>' +
    '</g></svg>';
  return el;
}

// Group bubble — the brand pin's palette in the shape the eye reads as "many":
// a filled circle with the count. Centred on the group (translate(-50%,-50%)),
// unlike the pin, which is tip-anchored.
function makeClusterBubble(count: number): HTMLElement {
  const { size, font } = bubbleTier(count);
  const el = document.createElement('div');
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    'transform:translate(-50%,-50%)',
    'border-radius:9999px',
    `background:${FILL_DEFAULT}`,
    'border:3px solid #fff',
    'color:#fff',
    `font-size:${font}px`,
    'font-weight:600',
    'line-height:1',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
    'filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))',
  ].join(';');
  el.textContent = String(count);
  return el;
}

/*
 * Live camera bounds → fetch box. Returns null when the rectangle is unusable,
 * which sends refetch to the city-wide boxAroundCenter fallback.
 *
 * This guard used to reject any span under 0.005° (~550m) on the theory that an
 * un-laid-out map reports a near-point. Both halves of that were wrong, and the
 * combination made every deep-zoom refetch pull the whole city:
 *
 *  - A real viewport IS smaller than 0.005° once you pass zoom ~17, so the guard
 *    fired on legitimate cameras — exactly when the user had asked for one block.
 *  - An un-laid-out map does not report a near-point. ymaps3 clamps the viewport
 *    to a 1×1 pixel minimum, so it reports a real box for a 1px map: measured at
 *    zoom 12, lon 3.433e-4 / lat 2.027e-4 (~22×22m). That is BIGGER than the
 *    1e-4 a "tighter threshold" would use — such a guard would pass the very
 *    read it exists to catch.
 *
 * No absolute degree threshold can separate the two, because the populations
 * overlap: one pixel at city zoom (~22×22m) covers the same ground as an entire
 * 760×560 viewport at ymaps3's max zoom of 21 (lon 5.096e-4 / lat 2.218e-4,
 * ~33×25m) — and a shorter phone viewport at max zoom is smaller still. Any
 * threshold that rejects the first rejects the second. So this only rejects what
 * is structurally unusable: a malformed/non-finite read, or a collapsed box.
 *
 * Dropping the size heuristic costs nothing real. The pre-layout read it was
 * written against does not occur on this path: the container is `absolute
 * inset-0` inside a fixed-height parent and is mounted only when the map view is
 * active (ResultsSwitcher swaps children, never pre-mounts hidden), so it is laid
 * out long before ymaps3.ready resolves and the map is constructed. Verified on a
 * live prod build — map.bounds is the true viewport from the synchronous read
 * after `new YMap` onward, identical at every sample through t+1000ms.
 *
 * The residual case, a 0×0 container, is accepted here by construction: its 1px
 * box is indistinguishable from a max-zoom viewport. It is also harmless — a
 * 0×0 map is invisible, and a container that later gains size moves the camera,
 * whose onUpdate refetches with real bounds.
 */
export function boxFromBounds(bounds: LngLatBounds | undefined): Box | null {
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
  if (
    box.neLat - box.swLat < DEGENERATE_SPAN ||
    box.neLon - box.swLon < DEGENERATE_SPAN
  ) {
    return null;
  }
  return box;
}

// Fallback box (~city metro span) for a bounds read the map cannot give us.
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
