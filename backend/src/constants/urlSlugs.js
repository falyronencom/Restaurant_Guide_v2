/**
 * URL Slug Mappings — Cyrillic ↔ Latin
 *
 * Maps internal Cyrillic display values (cities, categories, cuisines) to
 * URL-safe Latin slugs for the public web platform. Mobile continues to
 * use Cyrillic internally; web platform consumes slug-based URLs.
 *
 * Mogilev edge case: source data contains both 'Могилев' and 'Могилёв'
 * (per CITY_BOUNDS in establishmentService.js — both ё/е variants are
 * permitted to accommodate inconsistent input). Both Cyrillic forms map
 * to a single slug 'mogilev'; canonical reverse mapping returns 'Могилев'
 * (without ё), but DB queries must expand to cover both variants.
 *
 * Design: plain object maps for O(1) lookup, no I/O, no dependencies.
 * All helpers are pure functions suitable for unit testing in isolation.
 */

/**
 * City → URL slug map. Both 'Могилев' and 'Могилёв' resolve to 'mogilev'.
 */
export const CITY_SLUG_MAP = {
  'Минск': 'minsk',
  'Гродно': 'grodno',
  'Брест': 'brest',
  'Гомель': 'gomel',
  'Витебск': 'vitebsk',
  'Могилев': 'mogilev',
  'Могилёв': 'mogilev',
  'Бобруйск': 'bobruisk',
};

/**
 * Canonical city Cyrillic form per slug. Used by citySlugToCyrillic.
 * For Mogilev edge case: canonical = 'Могилев' (без ё). DB queries must
 * additionally cover 'Могилёв' via expandCityForQuery.
 */
const CANONICAL_CITY_BY_SLUG = {
  'minsk': 'Минск',
  'grodno': 'Гродно',
  'brest': 'Брест',
  'gomel': 'Гомель',
  'vitebsk': 'Витебск',
  'mogilev': 'Могилев',
  'bobruisk': 'Бобруйск',
};

/**
 * Category → URL slug map. 15 categories matching VALID_CATEGORIES
 * in establishmentService.js. English plurals chosen for natural
 * URL readability (restaurants, cafes, bars).
 */
export const CATEGORY_SLUG_MAP = {
  'Ресторан': 'restaurants',
  'Кафе': 'cafes',
  'Кофейня': 'coffee',
  'Бар': 'bars',
  'Пиццерия': 'pizza',
  'Пекарня': 'bakery',
  'Кондитерская': 'patisserie',
  'Фаст-фуд': 'fast-food',
  'Паб': 'pubs',
  'Столовая': 'canteens',
  'Кальянная': 'hookah',
  'Боулинг': 'bowling',
  'Караоке': 'karaoke',
  'Бильярд': 'billiards',
  'Клуб': 'clubs',
};

/**
 * Cuisine → URL slug map. 12 cuisines matching VALID_CUISINES
 * in establishmentService.js.
 */
export const CUISINE_SLUG_MAP = {
  'Народная': 'belarusian',
  'Авторская': 'signature',
  'Азиатская': 'asian',
  'Американская': 'american',
  'Вегетарианская': 'vegetarian',
  'Японская': 'japanese',
  'Грузинская': 'georgian',
  'Итальянская': 'italian',
  'Смешанная': 'mixed',
  'Европейская': 'european',
  'Китайская': 'chinese',
  'Восточная': 'eastern',
};

/**
 * Reverse map builder. Inverts a slug map (Cyrillic→Latin) into
 * Latin→Cyrillic. Skips duplicate slug values (Mogilev edge case).
 *
 * @param {Object} forwardMap - Cyrillic → slug map
 * @returns {Object} slug → Cyrillic map (first Cyrillic wins on collision)
 */
const buildReverseMap = (forwardMap) => {
  const reverse = {};
  for (const [cyrillic, slug] of Object.entries(forwardMap)) {
    if (!reverse[slug]) {
      reverse[slug] = cyrillic;
    }
  }
  return reverse;
};

const CATEGORY_BY_SLUG = buildReverseMap(CATEGORY_SLUG_MAP);
const CUISINE_BY_SLUG = buildReverseMap(CUISINE_SLUG_MAP);

/**
 * A map's own entry, or null. The maps are plain objects, and a plain object
 * answers for its prototype too: `MAP['constructor']` is the Object function,
 * `MAP['__proto__']` is Object.prototype — both truthy, so `?city=constructor`
 * passed the slug check as a city and came back as an empty catalog (200)
 * instead of 400 INVALID_SLUG (13.10.2026). Every helper below reads through
 * this; the site closed the same class with Object.hasOwn in eac58c0.
 *
 * @param {Object} map
 * @param {string} key
 * @returns {string|null}
 */
const ownEntry = (map, key) => (Object.hasOwn(map, key) ? map[key] : null);

/**
 * Convert city slug to canonical Cyrillic name.
 *
 * Mogilev edge case: 'mogilev' returns 'Могилев' (canonical without ё).
 * For DB queries that need to cover both ё/е variants in data, use
 * expandCityForQuery on the returned Cyrillic value.
 *
 * @param {string} slug - URL slug (e.g., 'minsk')
 * @returns {string|null} Cyrillic city name, or null if slug not in mapping
 */
export const citySlugToCyrillic = (slug) => {
  if (typeof slug !== 'string') return null;
  return ownEntry(CANONICAL_CITY_BY_SLUG, slug.toLowerCase());
};

/**
 * Convert Cyrillic city name to URL slug.
 * Both 'Могилев' and 'Могилёв' return 'mogilev'.
 *
 * @param {string} cyrillic - Cyrillic city name
 * @returns {string|null} URL slug, or null if not in mapping
 */
export const cityCyrillicToSlug = (cyrillic) => {
  if (typeof cyrillic !== 'string') return null;
  return ownEntry(CITY_SLUG_MAP, cyrillic);
};

/**
 * Convert category slug to Cyrillic name.
 *
 * @param {string} slug - URL slug (e.g., 'restaurants')
 * @returns {string|null} Cyrillic category, or null if slug not in mapping
 */
export const categorySlugToCyrillic = (slug) => {
  if (typeof slug !== 'string') return null;
  return ownEntry(CATEGORY_BY_SLUG, slug.toLowerCase());
};

/**
 * Convert Cyrillic category to URL slug.
 *
 * @param {string} cyrillic - Cyrillic category name
 * @returns {string|null} URL slug, or null if not in mapping
 */
export const categoryCyrillicToSlug = (cyrillic) => {
  if (typeof cyrillic !== 'string') return null;
  return ownEntry(CATEGORY_SLUG_MAP, cyrillic);
};

/**
 * Convert cuisine slug to Cyrillic name.
 *
 * @param {string} slug - URL slug (e.g., 'italian')
 * @returns {string|null} Cyrillic cuisine, or null if slug not in mapping
 */
export const cuisineSlugToCyrillic = (slug) => {
  if (typeof slug !== 'string') return null;
  return ownEntry(CUISINE_BY_SLUG, slug.toLowerCase());
};

/**
 * Convert Cyrillic cuisine to URL slug.
 *
 * @param {string} cyrillic - Cyrillic cuisine name
 * @returns {string|null} URL slug, or null if not in mapping
 */
export const cuisineCyrillicToSlug = (cyrillic) => {
  if (typeof cyrillic !== 'string') return null;
  return ownEntry(CUISINE_SLUG_MAP, cyrillic);
};

/**
 * Expand a canonical Cyrillic city to all data variants that must be
 * matched in DB queries. Handles the Mogilev ё/е data inconsistency:
 *   'Могилев' → ['Могилев', 'Могилёв']
 *   Other cities → single-element array.
 *
 * Use case: WHERE city = ANY($1::varchar[]) instead of WHERE city = $1
 * for any public catalog query that filters by city.
 *
 * @param {string} cyrillic - Canonical Cyrillic city (e.g., 'Могилев')
 * @returns {string[]} Array of all data variants to match
 */
export const expandCityForQuery = (cyrillic) => {
  if (cyrillic === 'Могилев' || cyrillic === 'Могилёв') {
    return ['Могилев', 'Могилёв'];
  }
  return [cyrillic];
};
