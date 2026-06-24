'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/*
 * EstablishmentMapOverlay — the in-page interactive-map overlay for a single
 * establishment (D-2A). Rendered ONCE per detail page (not inside MapPreview):
 * the page has two MapPreview triggers — main column + sidebar — and a single
 * page-level overlay avoids two modals firing on one ?map=1.
 *
 * Open state is the URL (?map=1), so it is addressable and the browser Back
 * button closes it. The triggers (MapPreviewTrigger) push the param; this
 * component reads it and drives the modal. Closing (✕, Escape, backdrop, or
 * Back) strips the param.
 *
 * The map is focused on THIS establishment via MapView's searchParams prop
 * (focus/flat/flng) — we do NOT write focus into the detail-page URL, so its
 * clean canonical URL is untouched. No category filter is passed: the overlay
 * shows everything nearby (Booking-style "explore around this place").
 *
 * Must be wrapped in <Suspense> by the page: it calls useSearchParams, and the
 * detail page is ISR — a static page reading useSearchParams from a Client
 * Component fails the production build without a Suspense boundary (dev masks
 * this). It renders nothing visible until ?map=1, so the fallback is null.
 */
const MapView = dynamic(() => import('@/components/map/MapView'), {
  ssr: false,
});

export function EstablishmentMapOverlay({
  citySlug,
  slug,
  name,
  latitude,
  longitude,
}: {
  citySlug: string;
  slug: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const open = sp.get('map') === '1';

  // No coordinates → nothing to centre a map on (mirror MapPreview's guard), so
  // there is no trigger and a stray ?map=1 must not open an empty map.
  if (latitude == null || longitude == null) return null;

  const close = () => {
    const params = new URLSearchParams(sp.toString());
    params.delete('map');
    const qs = params.toString();
    // replace (not push): the trigger opened with push, so the ?map=1 entry is
    // already in history and Back closes the overlay. Closing via ✕/Escape/
    // backdrop REPLACES that entry with the clean URL, so a subsequent Back
    // doesn't re-open the modal. Open=push + close=replace.
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className='w-[95vw] max-w-[1100px] gap-0 overflow-hidden p-0 sm:max-w-[1100px]'>
        <DialogTitle className='sr-only'>Карта — {name}</DialogTitle>
        <MapView
          citySlug={citySlug}
          searchParams={{
            focus: slug,
            flat: String(latitude),
            flng: String(longitude),
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
