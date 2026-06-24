'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

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
    <div>
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
