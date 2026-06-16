/**
 * Web-side slug → icon-file bridge for category & cuisine SVGs.
 *
 * The icons live in web/public/icons/ as Cyrillic-named SVGs, copied from
 * mobile/assets/icons/ by scripts/sync-icons.mjs. The canonical slug↔Cyrillic
 * mapping is backend-only (backend/src/constants/urlSlugs.js — ESM, not
 * web-importable), so this is a MANUAL-SYNC port: if a category or cuisine slug
 * changes there, mirror it here AND in sync-icons.mjs.
 *
 * This map resolves icon FILE basenames, not display names. They differ for one
 * entry: category `fast-food` (display «Фаст-фуд») ships as `ФастФуд.svg`
 * (camelCase, no hyphen) — encoded by the override below. Display NAMES come
 * from getMetadata(); never derive a label from this map.
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
 * slug has no mapped icon (caller may then render a fallback). Category and
 * cuisine slug namespaces are disjoint, so the merged lookup is unambiguous.
 *
 * The Cyrillic basename is URL-encoded so non-ASCII (and any future spaced)
 * file names resolve predictably regardless of how the request is serialized.
 */
export function iconUrlForSlug(slug: string): string | null {
  const file = CATEGORY_ICON_BY_SLUG[slug] ?? CUISINE_ICON_BY_SLUG[slug];
  if (!file) return null;
  return `/icons/${encodeURIComponent(file)}.svg`;
}
