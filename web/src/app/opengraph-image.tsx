import { ImageResponse } from 'next/og';

import { colors } from '@/lib/tokens';

/**
 * `app/opengraph-image.tsx` — Brand-default OG image (Brief 5).
 *
 * Generated programmatically via Next 16 `ImageResponse` — this file
 * convention auto-attaches to `og:image` meta tags for ALL route segments
 * unless overridden by a more-specific `opengraph-image.tsx` further down
 * the route tree or by explicit `openGraph.images` in a child
 * `generateMetadata` return.
 *
 * Per Brief 5 OG strategy (b): one static brand card for non-detail pages
 * (home / city / catalog); detail page overrides with per-establishment
 * `primary_image_url` via its own `generateMetadata`. Twitter inherits this
 * image when `twitter-image` is absent (X spec).
 *
 * Scope intent (Trunk locked): "программный brand-card (Nirivio wordmark на
 * brand-фоне) — НЕ полноценный template (это (c)/OG Polish). Заменяем
 * позже." A future OG Polish brief can replace this with a richer template
 * (per-page typography, accent shapes, hero photos) without disturbing the
 * file-convention interface.
 *
 * Font note: Satori (the engine behind `ImageResponse`) defaults to a
 * generic sans-serif when no font is loaded. Loading project's Unbounded
 * font would require fetching the .ttf — deferred to OG Polish; the
 * default sans renders Latin "Nirivio" cleanly.
 *
 * Next.js Route Handler — cached at build time (no Request-time APIs used).
 */

export const alt = 'Nirivio — гид по ресторанам и кафе Беларуси';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.brand.DEFAULT,
          color: '#FFFFFF',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 160,
            fontWeight: 700,
            letterSpacing: '-4px',
            lineHeight: 1,
          }}
        >
          Nirivio
        </div>
        <div
          style={{
            fontSize: 36,
            marginTop: 28,
            opacity: 0.92,
          }}
        >
          Гид по ресторанам и кафе Беларуси
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
