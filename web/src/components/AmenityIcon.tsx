import {
  BabyIcon,
  BikeIcon,
  CigaretteIcon,
  MusicIcon,
  PartyPopperIcon,
  PawPrintIcon,
  SquareParkingIcon,
  UmbrellaIcon,
  WifiIcon,
} from 'lucide-react';

type IconComponent = typeof WifiIcon;

/*
 * Attribute (amenity) slug → lucide line glyph. Keys match facets.ts
 * ATTRIBUTE_OPTIONS / establishment-helpers ATTRIBUTE_ORDER. Unlike the brand
 * pack (CategoryIcon, baked two-tone <img>s), these are recolorable inline SVGs
 * (currentColor) — used where the design wants thin line icons that follow the
 * pill/text color (catalog filter «Дополнительно», establishment «Атрибуты»).
 */
const ICON_BY_SLUG: Record<string, IconComponent> = {
  delivery: BikeIcon,
  wifi: WifiIcon,
  terrace: UmbrellaIcon,
  parking: SquareParkingIcon,
  live_music: MusicIcon,
  kids_zone: BabyIcon,
  banquet: PartyPopperIcon,
  pets_allowed: PawPrintIcon,
  smoking: CigaretteIcon,
};

type Props = {
  slug: string;
  size?: number;
  className?: string;
};

/**
 * Renders the lucide line icon for an attribute slug, or null when unmapped so
 * the caller can fall back. Decorative (aria-hidden) — the adjacent label
 * carries the meaning. Color follows `currentColor`, so set it via className.
 */
export function AmenityIcon({ slug, size = 16, className }: Props) {
  const Icon = ICON_BY_SLUG[slug];
  if (!Icon) return null;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
