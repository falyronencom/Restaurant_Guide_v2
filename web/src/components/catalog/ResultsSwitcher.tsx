'use client';

import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';

import type { SearchParams } from '@/lib/catalog-params';

/*
 * List ↔ map toggle for the catalog/city results (Этап 2 entry point, mirroring
 * mobile's results-list map icon).
 *
 * The server-rendered list is passed as `children` so it stays the SSR/SEO
 * surface; the map is a client-only island loaded on demand (dynamic ssr:false)
 * so the Yandex JS API script is fetched only when the user opens the map.
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
  const [view, setView] = useState<'list' | 'map'>('list');

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
