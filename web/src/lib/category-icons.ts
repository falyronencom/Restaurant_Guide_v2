/**
 * Web-side slug → icon-file bridge for category, cuisine & attribute SVGs.
 *
 * The icons live in web/public/icons/ as Cyrillic-named SVGs, copied from
 * mobile/assets/icons/ by scripts/sync-icons.mjs. The canonical slug↔Cyrillic
 * mapping is backend-only (backend/src/constants/urlSlugs.js — ESM, not
 * web-importable), so this is a MANUAL-SYNC port: if a category, cuisine, or
 * attribute slug changes there, mirror it here AND in sync-icons.mjs.
 *
 * Attribute (amenity) icons were added 2026-06-21 for the vitrine revision,
 * superseding the 2026-05-26 "web keeps lucide-react for amenities" decision —
 * the design handoff uses the brand SVG set across both surfaces.
 *
 * This map resolves icon FILE basenames, not display names. They differ for a
 * couple of entries: category `fast-food` (display «Фаст-фуд») ships as
 * `ФастФуд.svg` (camelCase, no hyphen); attribute `terrace` (display «Летняя
 * терраса») ships as `Терасса.svg`. Display NAMES come from getMetadata() /
 * facets.ts; never derive a label from this map.
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
 * Attribute (amenity) slug → icon file basename (Cyrillic, no extension).
 * 9 entries — keys match facets.ts ATTRIBUTE_OPTIONS / establishment-helpers
 * ATTRIBUTE_ORDER exactly. Note `terrace` → «Терасса» (file spelled with one
 * р / two с, even though the display label is «Летняя терраса»).
 */
export const ATTRIBUTE_ICON_BY_SLUG: Record<string, string> = {
  delivery: 'Доставка еды',
  wifi: 'Wifi',
  terrace: 'Терасса',
  parking: 'Парковка',
  live_music: 'Живая музыка',
  kids_zone: 'Детская зона',
  banquet: 'Банкет',
  pets_allowed: 'Животные',
  smoking: 'Курение',
};

/**
 * Resolve a category, cuisine, OR attribute slug to its public icon URL, or
 * null when the slug has no mapped icon (caller may then render a fallback).
 * The three slug namespaces are disjoint, so the merged lookup is unambiguous.
 *
 * The Cyrillic basename is URL-encoded so non-ASCII (and the spaced names like
 * «Доставка еды») resolve predictably regardless of how the request is
 * serialized.
 */
export function iconUrlForSlug(slug: string): string | null {
  const file =
    CATEGORY_ICON_BY_SLUG[slug] ??
    CUISINE_ICON_BY_SLUG[slug] ??
    ATTRIBUTE_ICON_BY_SLUG[slug];
  if (!file) return null;
  return `/icons/${encodeURIComponent(file)}.svg`;
}
