'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/*
 * MapPreviewTrigger — client wrapper that turns the (server-rendered) static map
 * preview into a button opening the in-page interactive-map overlay (D-2A).
 *
 * Opening is URL-driven (?map=1) so it is addressable and the browser Back
 * button closes it — EstablishmentMapOverlay reads the param and renders the
 * modal. We read window.location imperatively in the click handler instead of
 * useSearchParams, so this trigger needs NO Suspense boundary on the ISR detail
 * page; only the overlay (which must react to the param) does.
 *
 * The static preview image is built by the server MapPreview and passed in as
 * children, keeping the Referer-locked YANDEX_MAPS_API_KEY server-side.
 */
export function MapPreviewTrigger({ children }: { children: ReactNode }) {
  const router = useRouter();

  const open = () => {
    const params = new URLSearchParams(window.location.search);
    params.set('map', '1');
    router.push(`${window.location.pathname}?${params.toString()}`, {
      scroll: false,
    });
  };

  return (
    <button
      type='button'
      onClick={open}
      aria-haspopup='dialog'
      className='relative block h-[180px] w-full overflow-hidden rounded-card bg-muted text-left'
    >
      {children}
    </button>
  );
}
