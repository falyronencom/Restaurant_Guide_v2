/**
 * Design Tokens — Canonical TypeScript Module
 *
 * Source of truth: mobile/lib/config/theme.dart (AppTheme — colors, typography)
 *                  mobile/lib/config/dimensions.dart (AppDimensions — spacing, sizes, radii)
 *
 * Sync policy: mobile is the canonical source. On any token change, update
 * mobile/lib/config/* first, then propagate values here MANUALLY (Brief 2 D1
 * decision — no shared package, manual cross-target sync). Both directions
 * should match exactly for the values listed below.
 *
 * Notation: xs/s/m/l/xl/xxl (Tailwind-idiomatic) instead of Dart's
 * radiusXSmall/Small/etc. — see web mapping table in Brief 2 Discovery Report.
 *
 * Wiring: values mirrored in src/app/globals.css under :root and exposed to
 * Tailwind utility classes via @theme inline directive (Tailwind v4 pattern).
 * This TS module is the importable JS-side reference; CSS variables drive
 * runtime styling.
 */

export const colors = {
  brand: {
    DEFAULT: '#F06B32', // mobile primaryOrange
    dark: '#DB4F13',    // mobile primaryOrangeDark
    light: '#EC723D',   // mobile primaryOrangeLight
    shadow: '#D35620',  // mobile primaryOrangeShadow (button drop-shadow)
  },
  success: {
    DEFAULT: '#4CAF50',
    dark: '#388E3C',
    light: '#66BB6A',
    status: '#34C759', // mobile statusGreen — Figma "open" indicator
  },
  error: {
    DEFAULT: '#F44336',
    dark: '#D32F2F',
    light: '#E57373',
  },
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#EEEEEE',
    300: '#E0E0E0',
    400: '#BDBDBD',
    500: '#9E9E9E',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
  },
  figma: {
    backgroundWarm: '#F4F1EC', // beige page background
    strokeGrey: '#D2D2D2',     // dividers/borders
    textGrey: '#ABABAB',       // secondary grey text
    textDark: '#3E3E3E',       // near-black text
    accentNavy: '#3631C0',     // navy accent
  },
  text: {
    primary: '#000000',
    secondary: '#757575', // = gray.600
    tertiary: '#9E9E9E',  // = gray.500
    onPrimary: '#FFFFFF',
  },
  background: {
    primary: '#FFFFFF',
    secondary: '#FAFAFA', // = gray.50
    tertiary: '#F5F5F5',  // = gray.100
  },
} as const;

export const spacing = {
  xs: '4px',
  s: '8px',
  m: '16px',
  l: '24px',
  xl: '32px',
  xxl: '48px',
  // Semantic spacing (mobile dimensions.dart specifics)
  screenPadding: '20px',
  cardPadding: '16px',
  cardPaddingSmall: '12px',
} as const;

export const radii = {
  xs: '4px',
  s: '8px',
  m: '12px',
  l: '16px',
  xl: '24px',
  full: '9999px',
} as const;

export const iconSize = {
  xs: '12px',
  s: '16px',
  m: '24px',
  l: '32px',
  xl: '48px',
  xxl: '64px',
} as const;

export const elevation = {
  none: '0px',
  low: '2px',
  medium: '4px',
  high: '8px',
  xhigh: '16px',
} as const;

export const animation = {
  fast: '150ms',
  normal: '300ms',
  slow: '500ms',
} as const;

/**
 * Typography scale — display/headline/body/label/caption × l/m/s.
 * font sizes are in px; fontWeight numeric; letterSpacing optional.
 */
export const typography = {
  display: {
    l: { fontSize: '32px', fontWeight: 700, letterSpacing: '-0.5px' },
    m: { fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px' },
    s: { fontSize: '24px', fontWeight: 700, letterSpacing: '-0.3px' },
  },
  headline: {
    l: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.2px' },
    m: { fontSize: '18px', fontWeight: 600, letterSpacing: '-0.1px' },
    s: { fontSize: '16px', fontWeight: 600, letterSpacing: '0' },
  },
  body: {
    l: { fontSize: '16px', fontWeight: 400, letterSpacing: '0.1px' },
    m: { fontSize: '14px', fontWeight: 400, letterSpacing: '0.1px' },
    s: { fontSize: '12px', fontWeight: 400, letterSpacing: '0.2px' },
  },
  label: {
    l: { fontSize: '16px', fontWeight: 500, letterSpacing: '0.1px' },
    m: { fontSize: '14px', fontWeight: 500, letterSpacing: '0.1px' },
    s: { fontSize: '12px', fontWeight: 500, letterSpacing: '0.2px' },
  },
  caption: {
    l: { fontSize: '14px', fontWeight: 400, letterSpacing: '0.2px' },
    m: { fontSize: '12px', fontWeight: 400, letterSpacing: '0.2px' },
    s: { fontSize: '10px', fontWeight: 400, letterSpacing: '0.3px' },
  },
} as const;

/**
 * Font families — actual font loading happens via next/font/google in
 * src/app/layout.tsx. These are the CSS variable names exposed to the
 * document; reference them via Tailwind classes (font-sans, font-display,
 * font-wordmark).
 *
 * - Unbounded: display/accent (headings)
 * - Nunito Sans: body/default
 * - Josefin Sans: wordmark «NIRIVIO» only (web-local, latin-only — NO Cyrillic
 *   subset; not mirrored in mobile theme.dart, which has no wordmark)
 */
export const fonts = {
  display: 'var(--font-unbounded)',
  sans: 'var(--font-nunito-sans)',
  wordmark: 'var(--font-josefin)',
} as const;

/**
 * Web-local design tokens — NOT part of the mobile triple-sync.
 *
 * Introduced for the vitrine revision (2026-06-21); mirror of the web-local
 * block in src/app/globals.css. Mobile has no equivalent — these are
 * web-surface specifics (warm divider inside beige cards, light warm header
 * border, mid-tier rating color, and the 20px card radius the revision uses
 * pervasively). Do NOT propagate these to mobile/lib/config/*.
 */
export const webLocal = {
  colors: {
    figmaDivider: '#E4DFD6',     // → border-figma-divider / bg-figma-divider
    figmaBorderLight: '#ECE8E1', // → border-figma-border-light
    figmaRatingMid: '#8BC34A',   // → bg-figma-rating-mid (rating just below green)
  },
  radii: {
    card: '20px', // → rounded-card
  },
} as const;
