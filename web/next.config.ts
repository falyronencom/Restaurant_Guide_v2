import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * Image hosts allowed for `<Image>` remote URLs — everything else gets 400
   * from the Image Optimization API (/_next/image).
   *
   * res.cloudinary.com/davrzdre8/image/upload — the uploaded images of our
   *   Cloudinary account, where the backend puts every partner upload, and
   *   only them: the optimizer decodes whatever it fetches, so it should fetch
   *   from nowhere but our own storage (decoder advisories such as
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
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/davrzdre8/image/upload/**',
      },
    ],
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
