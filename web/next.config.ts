import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * Image hosts allowed for `<Image>` remote URLs — everything else gets 400
   * from the Image Optimization API (/_next/image).
   *
   * fastly.picsum.photos — Lorem Picsum placeholders of the early seed
   *   (Brief 3); no production image uses it since the 18.07.2026 wipe.
   * res.cloudinary.com/davrzdre8 — our Cloudinary account, where the backend
   *   puts every partner upload, and only it: the optimizer decodes whatever
   *   it fetches, so it should fetch from nowhere but our own storage (decoder
   *   advisories such as GHSA-2xp9-vwfh-vxw4 are fixed by upgrading next;
   *   this keeps the surface small between upgrades). Checked 30.09.2026:
   *   all 278 image URLs of the production catalogue (list, cards, reviews)
   *   are under /davrzdre8/. Cloudinary URLs carry the SDK tag `?_a=…`, so
   *   `search` stays open. If the account ever changes, this entry changes
   *   with it — image-remote-patterns.test.ts pins the name.
   */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fastly.picsum.photos',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/davrzdre8/**',
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
