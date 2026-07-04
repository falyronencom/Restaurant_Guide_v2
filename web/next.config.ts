import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * Image hosts allowed for `<Image>` remote URLs.
   *
   * fastly.picsum.photos — current production seed (Lorem Picsum placeholders
   *   used while real partner uploads are absent). Discovered Brief 3.
   * res.cloudinary.com — anticipated real-data host once partners upload via
   *   backend Cloudinary pipeline. Path-pattern intentionally broad until
   *   cloud_name is verified and locked in (CAT for future tightening).
   *
   * Per Next.js images docs: prefer narrowest pathname acceptable. When
   * cloud_name is confirmed, change Cloudinary entry to
   *   `pathname: '/{cloud_name}/**'` to restrict to single account.
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
        pathname: '/**',
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
