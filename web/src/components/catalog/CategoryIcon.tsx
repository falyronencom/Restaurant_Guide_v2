import { iconUrlForSlug } from '@/lib/category-icons';
import { cn } from '@/lib/utils';

type Props = {
  /** Category or cuisine slug (disjoint namespaces — either resolves). */
  slug: string;
  /** Accessible label. Empty (default) marks the icon decorative. */
  alt?: string;
  /** Rendered square size in px. */
  size?: number;
  className?: string;
};

/**
 * Renders a bridged category/cuisine SVG from web/public/icons/.
 *
 * Plain <img> rather than next/image: these are small, local, trusted SVGs.
 * next/image would either refuse the SVG (without the global, security-relevant
 * `dangerouslyAllowSVG`) or need `unoptimized`, and a raw <img> keeps full
 * control over the URL-encoded Cyrillic file name. Returns null for an unmapped
 * slug so callers can fall back.
 */
export function CategoryIcon({ slug, alt = '', size = 24, className }: Props) {
  const src = iconUrlForSlug(slug);
  if (!src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- local trusted SVG icon; see doc comment
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      // Fixed square box + contain. Tailwind Preflight forces `img { height: auto }`,
      // which — now that the bridged SVGs carry differing intrinsic aspect ratios
      // (each viewBox tightened to its content) — would give every icon a different
      // rendered height and misalign the filter-tile labels. Pin both dimensions
      // (inline style beats Preflight) and letterbox the glyph, mirroring mobile's
      // SvgPicture(width, height, BoxFit.contain).
      style={{ width: size, height: size }}
      className={cn('object-contain', className)}
    />
  );
}
