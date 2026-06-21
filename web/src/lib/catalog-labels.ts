/**
 * Catalog listing labels — Russian plural category names + genitive city names
 * for the catalog heading «Рестораны Минска».
 *
 * Why hand-curated maps: Russian declension is irregular and the metadata API
 * returns only the singular nominative `name`. Plurals: Кафе/Караоке are
 * indeclinable (plural == singular); Столовая/Кальянная/Бильярдная are
 * adjective-nouns (→ -ые/-ие). Genitive city: Гродно is indeclinable;
 * Гомель→Гомеля (soft). Keyed by the stable URL slug — keep in sync with the
 * backend category/city sets (backend/src/constants/urlSlugs.js) if they change.
 *
 * Scope: these LISTING forms are used only in the catalog heading, breadcrumb
 * and SEO title/description. Everywhere else the singular nominative `name` is
 * correct (category chips, the detail page super-category line, card subtitles)
 * and must NOT use these.
 */

/** Category URL slug → Russian plural display form. 15 entries. */
export const CATEGORY_PLURAL_BY_SLUG: Record<string, string> = {
  restaurants: 'Рестораны',
  cafes: 'Кафе', // indeclinable — plural == singular
  coffee: 'Кофейни',
  bars: 'Бары',
  pizza: 'Пиццерии',
  bakery: 'Пекарни',
  patisserie: 'Кондитерские',
  'fast-food': 'Фастфуд', // uncountable — kept as-is
  pubs: 'Пабы',
  canteens: 'Столовые',
  hookah: 'Кальянные',
  bowling: 'Боулинги',
  karaoke: 'Караоке', // indeclinable
  billiards: 'Бильярдные',
  clubs: 'Клубы',
};

/** City URL slug → Russian genitive form («Рестораны Минска»). */
export const CITY_GENITIVE_BY_SLUG: Record<string, string> = {
  minsk: 'Минска',
  grodno: 'Гродно', // indeclinable
  brest: 'Бреста',
  gomel: 'Гомеля',
  vitebsk: 'Витебска',
  mogilev: 'Могилёва',
  bobruisk: 'Бобруйска',
};

/** Plural category for a slug, falling back to the singular metadata name. */
export function categoryPlural(slug: string, fallbackName: string): string {
  return CATEGORY_PLURAL_BY_SLUG[slug] ?? fallbackName;
}

/** Genitive city for a slug, falling back to the nominative metadata name. */
export function cityGenitive(slug: string, fallbackName: string): string {
  return CITY_GENITIVE_BY_SLUG[slug] ?? fallbackName;
}

/**
 * Catalog heading «{plural} {city-genitive}», e.g. «Рестораны Минска». Unknown
 * slugs degrade to the plain metadata names (defensive — all current
 * categories/cities are mapped above).
 */
export function catalogHeading(
  categorySlug: string,
  categoryName: string,
  citySlug: string,
  cityName: string,
): string {
  return `${categoryPlural(categorySlug, categoryName)} ${cityGenitive(citySlug, cityName)}`;
}
