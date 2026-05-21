import type { Metadata } from 'next';
import { Unbounded, Nunito_Sans } from 'next/font/google';
import './globals.css';

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

export const metadata: Metadata = {
  title: {
    default: 'Restaurant Guide Belarus',
    template: '%s | Restaurant Guide Belarus',
  },
  description: 'Гид по ресторанам и кафе Беларуси',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang='ru'
      className={`${unbounded.variable} ${nunitoSans.variable} h-full antialiased`}
    >
      <body className='min-h-full flex flex-col'>{children}</body>
    </html>
  );
}
