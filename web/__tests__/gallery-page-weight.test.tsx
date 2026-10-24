/**
 * Gallery page weight (D1, 21.10.2026) — the card page renders the gallery
 * twice (phone carousel + desktop mosaic) and hides one with CSS, so what the
 * browser downloads up front is decided by two things this test pins:
 *
 *   1. Every gallery <img> is lazy. A lazy image under display:none is never
 *      fetched; `priority` made the first photo of each tree eager and
 *      preloaded with no media query, so a desktop downloaded the hidden
 *      carousel's 1920px copy (prod 18.10: +301 KB) and a DPR-3 phone the
 *      hidden mosaic's 750px copy.
 *   2. The two hero preloads carry a media query each — the phone one only
 *      below Tailwind `md:` (48rem), the desktop one only at/above it — and the
 *      same srcset/sizes as their visible <img>, so the browser preloads the
 *      exact candidate the <img> will ask for and nothing else.
 *
 * The weights themselves are measured in a real browser (session report); the
 * jsdom side can only prove the markup that produces them. Gallery is a sync
 * Server Component; rendered on the client here, react-dom's `preload()`
 * inserts its <link> into document.head, which is what is read below. The
 * server path (RSC hint → streamed <link media>) is not run by jsdom — it was
 * checked in a browser against a production build (initiator `link`, one
 * download per photo).
 */
import { render } from '@testing-library/react';

import { Gallery } from '@/components/establishment/Gallery';
import type { PublicMedia } from '@/lib/api/types';

// react-dom remembers every preload it has inserted for the document and
// never inserts the same one again — each case gets its own photo URLs, and
// reads only the links that carry them.
let set = 0;

const photo = (n: number): PublicMedia => ({
  id: `p${n}`,
  url: `https://res.cloudinary.com/davrzdre8/image/upload/c_limit,w_1920/s${set}/${n}`,
  preview_url: `https://res.cloudinary.com/davrzdre8/image/upload/c_limit,w_1200/s${set}/${n}`,
  file_type: 'image',
  type: 'interior',
  caption: null,
});

const imagePreloads = () =>
  Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'),
  ).filter((l) => (l.getAttribute('imagesrcset') ?? '').includes(`%2Fs${set}%2F`));

beforeEach(() => {
  set += 1;
});

function renderGallery(count: number) {
  const media = Array.from({ length: count }, (_, i) => photo(i + 1));
  return render(
    <Gallery media={media} primaryImageUrl={null} establishmentName='Тест' />,
  );
}

describe('Gallery — hidden tree is never downloaded', () => {
  it('keeps every gallery image lazy (no eager hero in either tree)', () => {
    const { container } = renderGallery(5);
    const imgs = Array.from(container.querySelectorAll('img'));
    // 5 carousel slides + 3 mosaic tiles.
    expect(imgs).toHaveLength(8);
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(
      Array(8).fill('lazy'),
    );
  });

  it('preloads the first photo once per tree, each behind its own breakpoint', () => {
    const { container } = renderGallery(5);
    const links = imagePreloads();

    expect(links.map((l) => l.getAttribute('media')).sort()).toEqual([
      '(min-width: 48rem)',
      'not all and (min-width: 48rem)',
    ]);

    // The carousel is the md:hidden tree; the mosaic is hidden md:grid.
    const carouselFirst = container.querySelector('.md\\:hidden img')!;
    const mosaicMain = container.querySelector('.md\\:grid img')!;
    const phone = links.find((l) => l.getAttribute('media')!.startsWith('not'))!;
    const desktop = links.find((l) => l.getAttribute('media') === '(min-width: 48rem)')!;

    // Same candidates and the same slot width as the <img> the link serves —
    // otherwise the browser preloads one width and the <img> asks for another.
    expect(phone.getAttribute('imagesrcset')).toBe(carouselFirst.getAttribute('srcset'));
    expect(phone.getAttribute('imagesizes')).toBe(carouselFirst.getAttribute('sizes'));
    expect(desktop.getAttribute('imagesrcset')).toBe(mosaicMain.getAttribute('srcset'));
    expect(desktop.getAttribute('imagesizes')).toBe(mosaicMain.getAttribute('sizes'));

    // And it is the first photo's preview, not the 1920 original.
    expect(phone.getAttribute('imagesrcset')).toContain(
      encodeURIComponent(photo(1).preview_url!),
    );
    expect(phone.getAttribute('fetchpriority')).toBe('high');
    expect(desktop.getAttribute('fetchpriority')).toBe('high');
  });

  it('pins the slot widths of the phone slide and the main tile from 1152px up', () => {
    const { container } = renderGallery(3);
    // 85% of the viewport minus the 2×24px page padding (rendered 291px at
    // 390px wide, 21.10) — never below the box, so never softer.
    expect(container.querySelector('.md\\:hidden img')!.getAttribute('sizes')).toBe(
      'calc(85vw - 40px)',
    );
    // max-w-6xl caps the page at 1152px; the main tile is then 689px wide.
    expect(container.querySelector('.md\\:grid img')!.getAttribute('sizes')).toBe(
      '(min-width: 1152px) 690px, (max-width: 1024px) 60vw, 45vw',
    );
  });
});
