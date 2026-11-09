import type { NextConfig } from 'next';

/*
 * Card photos in our cloud, in every form the backend issues: up to three
 * segments ahead of the folder — a transformation of one or two segments
 * (generateImageUrl, the PDF cover) and a version — then establishments/…
 * (uploadImage, uploadPdf, the partner's wizard uploads under
 * establishments/temp/). `*` is one segment; `**` works only at the end of a
 * pattern (next/dist/docs, Image `remotePatterns`), hence one pattern per depth.
 */
const CARD_PHOTO_PATHS = ['', '*/', '*/*/', '*/*/*/'].map(
  (ahead) => `/davrzdre8/image/upload/${ahead}establishments/**`,
);

const nextConfig: NextConfig = {
  /*
   * Image hosts allowed for `<Image>` remote URLs — everything else gets 400
   * from the Image Optimization API (/_next/image).
   *
   * res.cloudinary.com/davrzdre8/image/upload/…/establishments/ — the card
   *   photos of our Cloudinary account, where the backend puts every partner
   *   upload, and only them: the optimizer decodes whatever it fetches, so it
   *   should fetch from nowhere but our own storage (decoder advisories such as
   *   GHSA-2xp9-vwfh-vxw4 are fixed by upgrading next; this keeps the surface
   *   small between upgrades). Checked 30.09.2026: all 278 image URLs of the
   *   production catalogue (list, cards, reviews) are under /davrzdre8/; every
   *   form the backend issues and the site's avatars read is
   *   /image/upload/ (backend config/cloudinary.js, lib/avatar-source.ts), so
   *   the account's other delivery types (video, raw, fetch) stay out.
   *   Cloudinary URLs carry the SDK tag `?_a=…`, so `search` stays open. If
   *   the account ever changes, this entry changes with it —
   *   image-remote-patterns.test.ts pins the name.
   *
   *   People's photos (avatars/) are not admitted, in any form: the optimizer
   *   keeps its copy on the site's disk, and on 09.11.2026 that copy of a
   *   profile photo was still served after the account was deleted and the
   *   cloud answered 404. Review avatars load straight from the cloud
   *   (lib/avatar-source); the folder is refused here too, because anyone may
   *   ask /_next/image?url=<avatar> directly. Card photos are every image the
   *   site sends through the optimizer (catalogue, card gallery and menu,
   *   promotions, map preview, the cabinet's media) — the backend files them
   *   all under establishments/ (backend config/cloudinary.js, ownedFolders).
   *
   * Until 03.11.2026 the list also admitted fastly.picsum.photos (placeholders
   * of the early seed; no production image used it since the 18.07.2026 wipe)
   * and every path of the account (thread «Расходы посторонних», point 8).
   */
  images: {
    /*
     * The most the optimizer downloads of one remote file before it checks
     * it is an image: 5 MB, not Next's 50. Our photos are kept at most 1920 px
     * wide (backend config/cloudinary.js, incoming transformation) — well
     * under a megabyte; the menu PDFs share the folder of the photos and run
     * up to 10 MB, and the optimizer never needs them (review of the thread
     * «Расходы посторонних», 03.11.2026).
     */
    maximumResponseBody: 5_000_000,
    remotePatterns: CARD_PHOTO_PATHS.map((pathname) => ({
      protocol: 'https' as const,
      hostname: 'res.cloudinary.com',
      pathname,
    })),
  },

  /*
   * Static security headers for every route (OSB-P3).
   *
   * Deliberately NO Content-Security-Policy: a full CSP for Next 16 /
   * React 19 (inline runtime chunks, streamed RSC payloads, Yandex Maps)
   * is high-fragility to author and maintain for a solo operator and is
   * explicitly non-gating — see OSB assessment / CAT-C-4.3. Keep this list
   * to cheap static headers.
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
