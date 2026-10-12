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
 * Scope: these LISTING forms are used only in the catalog heading, breadcrumb,
 * SEO title/description and the way back from a missing establishment
 * (catalogBackLink). Everywhere else the singular nominative `name` is correct
 * (category chips, the detail page super-category line, card subtitles) and
 * must NOT use these.
 *
 * Slugs reach these helpers straight from the address, so the maps are read by
 * own key only: a plain object also answers `constructor`, `toString` and the
 * rest of its prototype — `/constructor` used to title the city page
 * «Заведения function Object() { [native code] }», and `/minsk/constructor`
 * threw on `.toLowerCase()` in generateMetadata.
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

function ownLabel(
  map: Record<string, string>,
  slug: string,
): string | undefined {
  return Object.hasOwn(map, slug) ? map[slug] : undefined;
}

/** Plural category for a slug, falling back to the singular metadata name. */
export function categoryPlural(slug: string, fallbackName: string): string {
  return ownLabel(CATEGORY_PLURAL_BY_SLUG, slug) ?? fallbackName;
}

/** Genitive city for a slug, falling back to the nominative metadata name. */
export function cityGenitive(slug: string, fallbackName: string): string {
  return ownLabel(CITY_GENITIVE_BY_SLUG, slug) ?? fallbackName;
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

/** City heading «Заведения {city-genitive}», e.g. «Заведения Минска». */
export function cityHeading(citySlug: string, cityName: string): string {
  return `Заведения ${cityGenitive(citySlug, cityName)}`;
}

/**
 * The way back from an establishment address that led nowhere: the category
 * in that city, else the city, else the home page. A slug counts as known when
 * the maps above carry it. They mirror the backend sets: a slug the backend
 * adds before this file does costs one level of precision; one it renames or
 * drops while a map still carries it would send the link to «Категория не
 * найдена» — hence the keep-in-sync note at the top.
 */
export function catalogBackLink(
  citySlug: string | undefined,
  categorySlug: string | undefined,
): { href: string; label: string } {
  const city = citySlug ? ownLabel(CITY_GENITIVE_BY_SLUG, citySlug) : undefined;
  if (!city) return { href: '/', label: 'На главную' };

  const category = categorySlug
    ? ownLabel(CATEGORY_PLURAL_BY_SLUG, categorySlug)
    : undefined;
  if (!category) {
    return { href: `/${citySlug}`, label: `Посмотреть заведения ${city}` };
  }

  return {
    href: `/${citySlug}/${categorySlug}`,
    label: `Посмотреть ${category.toLowerCase()} ${city}`,
  };
}
