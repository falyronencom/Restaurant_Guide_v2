/**
 * Web-side slug → icon-file bridge for category & cuisine SVGs.
 *
 * The icons live in web/public/icons/ as Cyrillic-named SVGs, copied from
 * mobile/assets/icons/ by scripts/sync-icons.mjs. The canonical slug↔Cyrillic
 * mapping is backend-only (backend/src/constants/urlSlugs.js — ESM, not
 * web-importable), so this is a MANUAL-SYNC port: if a category or cuisine slug
 * changes there, mirror it here AND in sync-icons.mjs.
 *
 * Amenity (attribute) icons are NOT bridged here — the web renders them as
 * recolorable lucide line glyphs via components/AmenityIcon.tsx (the standing
 * 2026-05-26 "web keeps lucide-react for amenities" decision). The 2026-06-21
 * vitrine revision briefly swapped in the brand SVG set, then reverted.
 *
 * This map resolves icon FILE basenames, not display names: category
 * `fast-food` (display «Фаст-фуд») ships as `ФастФуд.svg` (camelCase, no
 * hyphen). Display NAMES come from getMetadata() / facets.ts; never derive a
 * label from this map.
 */

/** Category slug → icon file basename (Cyrillic, no extension). 15 entries. */
export const CATEGORY_ICON_BY_SLUG: Record<string, string> = {
  restaurants: 'Ресторан',
  cafes: 'Кафе',
  coffee: 'Кофейня',
  bars: 'Бар',
  pizza: 'Пиццерия',
  bakery: 'Пекарня',
  patisserie: 'Кондитерская',
  'fast-food': 'ФастФуд', // override: display «Фаст-фуд», file «ФастФуд.svg»
  pubs: 'Паб',
  canteens: 'Столовая',
  hookah: 'Кальянная',
  bowling: 'Боулинг',
  karaoke: 'Караоке',
  billiards: 'Бильярд',
  clubs: 'Клуб',
};

/** Cuisine slug → icon file basename (Cyrillic, no extension). 12 entries. */
export const CUISINE_ICON_BY_SLUG: Record<string, string> = {
  belarusian: 'Народная',
  signature: 'Авторская',
  asian: 'Азиатская',
  american: 'Американская',
  vegetarian: 'Вегетарианская',
  japanese: 'Японская',
  georgian: 'Грузинская',
  italian: 'Итальянская',
  mixed: 'Смешанная',
  european: 'Европейская',
  chinese: 'Китайская',
  eastern: 'Восточная',
};

/**
 * Resolve a category OR cuisine slug to its public icon URL, or null when the
 * slug has no mapped icon (caller may then render a fallback). The two slug
 * namespaces are disjoint, so the merged lookup is unambiguous.
 *
 * The Cyrillic basename is URL-encoded so non-ASCII resolves predictably
 * regardless of how the request is serialized.
 */
export function iconUrlForSlug(slug: string): string | null {
  const file = CATEGORY_ICON_BY_SLUG[slug] ?? CUISINE_ICON_BY_SLUG[slug];
  if (!file) return null;
  return `/icons/${encodeURIComponent(file)}.svg`;
}
