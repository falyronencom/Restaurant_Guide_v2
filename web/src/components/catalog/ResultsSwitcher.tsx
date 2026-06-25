'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import type { SearchParams } from '@/lib/catalog-params';

/*
 * List ↔ map toggle for the catalog/city results (Этап 2 entry point, mirroring
 * mobile's results-list map icon).
 *
 * The server-rendered list is passed as `children` so it stays the SSR/SEO
 * surface; the map is a client-only island loaded on demand (dynamic ssr:false)
 * so the Yandex JS API script is fetched only when the user opens the map.
 *
 * View lives in the URL (?view=map), not local state, so an establishment card
 * can deep-link straight into the map (Slice D part 1: ?view=map&focus=…). The
 * host pages are force-dynamic, so reading useSearchParams needs no Suspense
 * boundary (it resolves on the server during the initial render).
 */
const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
});

// Offset (px) the results section (toggle + map) is lifted to under the sticky
// header on entering map view — small enough that the Найдено/Sort toolbar above
// the toggle tucks fully behind the header (no clipped text), with a little
// breathing room beneath the header.
const MAP_VIEW_TOP_OFFSET = 80;

export function ResultsSwitcher({
  citySlug,
  categorySlug,
  searchParams,
  children,
}: {
  citySlug: string;
  categorySlug?: string;
  searchParams: SearchParams;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const view = sp.get('view') === 'map' ? 'map' : 'list';
  const rootRef = useRef<HTMLDivElement>(null);

  // Immersive map: when the map opens, lift the results section (the
  // Списком/На карте toggle + the map) under the header so the whole map — and
  // its bottom preview card — sits on screen without the user scrolling below
  // the fold (the catalog hero pushes it down), while the toggle stays reachable
  // for the trip back to the list. Mirrors Booking/Yandex's full-height map
  // view; the sticky filter rail stays put.
  useEffect(() => {
    if (view !== 'map') return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    // The map is a dynamic (ssr:false) island: on a cold load its chunk lays out
    // AFTER this effect first runs, so the page isn't yet tall enough to scroll
    // to (scrollTo would clamp to 0). Retry briefly until the target is
    // reachable, then do one smooth lift.
    const lift = () => {
      if (cancelled) return;
      const el = rootRef.current;
      if (el) {
        const target =
          el.getBoundingClientRect().top + window.scrollY - MAP_VIEW_TOP_OFFSET;
        const maxScroll =
          document.documentElement.scrollHeight - window.innerHeight;
        if (target <= maxScroll + 1 || tries >= 12) {
          window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
          return;
        }
      }
      tries += 1;
      timer = setTimeout(lift, 100);
    };
    timer = setTimeout(lift, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view]);

  const setView = (next: 'list' | 'map') => {
    const params = new URLSearchParams(sp.toString());
    if (next === 'map') {
      params.set('view', 'map');
    } else {
      // Back to the list → drop map-only params so the URL stays clean.
      params.delete('view');
      params.delete('focus');
      params.delete('flat');
      params.delete('flng');
    }
    const qs = params.toString();
    // scroll:false — toggling in place shouldn't jump the viewport to the top.
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div ref={rootRef}>
      <div className="mb-m flex justify-end">
        <div className="inline-flex rounded-full border border-figma-border-light p-1 text-caption-l">
          <button
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={tabClass(view === 'list')}
          >
            Списком
          </button>
          <button
            type="button"
            onClick={() => setView('map')}
            aria-pressed={view === 'map'}
            className={tabClass(view === 'map')}
          >
            На карте
          </button>
        </div>
      </div>

      {view === 'list' ? (
        children
      ) : (
        <MapView
          citySlug={citySlug}
          categorySlug={categorySlug}
          searchParams={searchParams}
          className="lg:h-[calc(100dvh-10rem)]"
        />
      )}
    </div>
  );
}

function tabClass(active: boolean): string {
  return [
    'rounded-full px-4 py-1.5 transition-colors',
    active
      ? 'bg-brand text-white'
      : 'text-muted-foreground hover:text-foreground',
  ].join(' ');
}
