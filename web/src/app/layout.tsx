import type { Metadata } from 'next';
import { Unbounded, Nunito_Sans } from 'next/font/google';
import './globals.css';
import { getSiteUrl, isNoIndexMode } from '@/lib/seo-gate';
import { AuthProvider } from '@/components/auth/AuthProvider';

/*
 * Fonts — derived from mobile theme.dart:
 *   Unbounded: display/accent (mobile fontDisplayFamily)
 *   Nunito Sans: body/default (mobile textTheme via nunitoSansTextTheme)
 *
 * next/font/google self-hosts fonts at build time (no external Google request
 * at runtime). CSS variables exposed to document for Tailwind utility classes
 * (font-sans, font-display) and direct CSS var consumption.
 */
const unbounded = Unbounded({
  variable: '--font-unbounded',
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
});

const nunitoSans = Nunito_Sans({
  variable: '--font-nunito-sans',
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
});

/*
 * Brief 5 — SEO Core. Env vars read once at module load:
 *   - SITE_URL     → metadataBase (absolute canonical/OG promotion)
 *   - NOINDEX_MODE → gate layer 3 (defense-in-depth meta robots tag)
 * Gate is fail-safe ON; explicit 'false' opens. See web/src/lib/seo-gate.ts.
 */
const SITE_URL = getSiteUrl();
const NOINDEX = isNoIndexMode();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Nirivio',
    template: '%s | Nirivio',
  },
  description: 'Гид по ресторанам и кафе Беларуси',
  openGraph: {
    siteName: 'Nirivio',
    locale: 'ru_BY',
    type: 'website',
    // og:image inherited from `app/opengraph-image.tsx` file convention.
    // Detail page overrides via its own generateMetadata return with
    // per-establishment absolute primary_image_url.
  },
  twitter: {
    card: 'summary_large_image',
    // twitter:image inherits og:image when absent (X spec) — no separate
    // twitter-image.tsx needed at root for the (b) strategy.
  },
  // Gate layer 3 (defense-in-depth). CAT-C-2.3 page-level filter-aware
  // robots overrides on /[city]/[category] remain compatible — child
  // metadata wins.
  robots: NOINDEX ? { index: false, follow: false } : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Public Google Web client_id — server-read so the no-NEXT_PUBLIC_ discipline
  // holds; passed as a prop into the client AuthProvider (the id is public by
  // OAuth design and ships in the DOM via GIS regardless). Reading process.env
  // here does NOT opt the layout into dynamic rendering (only cookies()/headers
  // do), so the public catalog's ISR posture is preserved.
  const googleClientId = process.env.GOOGLE_CLIENT_ID || null;
  return (
    <html
      lang='ru'
      className={`${unbounded.variable} ${nunitoSans.variable} h-full antialiased`}
    >
      <body className='min-h-full flex flex-col'>
        <AuthProvider googleClientId={googleClientId}>{children}</AuthProvider>
      </body>
    </html>
  );
}
