import { ImageResponse } from 'next/og';

import { colors } from '@/lib/tokens';

/**
 * `app/apple-icon.tsx` — Apple touch icon (Brief 5).
 *
 * Programmatic icon via Next 16 `ImageResponse` + file convention.
 * Auto-attaches `<link rel="apple-touch-icon">` in `<head>` at 180×180.
 *
 * Closes the gap Discovery QP3 identified: prior to Brief 5 only
 * `favicon.ico` existed (Next default scaffold) — no apple-touch-icon for
 * iOS home screen pinning.
 *
 * Scope intent matches `opengraph-image.tsx`: simple Nirivio mark on brand
 * background, replaceable by full OG/icon Polish brief later. Stricter icon
 * sizing variants (`icon.tsx` at multiple resolutions) deferred per D3.
 */

export const size = {
  width: 180,
  height: 180,
};

export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.brand.DEFAULT,
          color: '#FFFFFF',
          fontFamily: 'sans-serif',
          fontSize: 120,
          fontWeight: 700,
          letterSpacing: '-2px',
        }}
      >
        N
      </div>
    ),
    {
      ...size,
    },
  );
}
