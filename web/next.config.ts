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
};

export default nextConfig;
