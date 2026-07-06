/**
 * Establishment Vocabulary — single source of truth (CAT-C-2.9).
 *
 * Consolidates the category/cuisine canon that was previously duplicated
 * byte-identically across establishmentService.js, establishmentValidation.js,
 * and smartSearchService.js. All three now import from here, so the DB CHECK
 * (migration 030), the validators, and the AI-search prompt can never drift.
 *
 * Canon values are the Cyrillic display names stored at-rest in
 * establishments.categories / .cuisines (CAT-C-2.9: Cyrillic-canonical at-rest).
 * The URL slug maps in ./urlSlugs.js are keyed by exactly these values — a
 * consistency test asserts every canon value has a slug (discoverability
 * invariant: canon category → non-null category_slug in the public projection).
 *
 * Scope note: VALID_CITIES is intentionally NOT consolidated here — it already
 * carries a live DB CHECK and sits outside the CAT-C-2.9 category/cuisine remit.
 * searchValidation.js (dead, unwired) is likewise left alone — its removal
 * belongs to the AF1 reconciliation slice (SDL CAT-C-3.15), which post-dates
 * this consolidation.
 */

/**
 * Canonical establishment categories (15).
 * Order matches the historical source of truth (establishmentService.js).
 * Membership — not order — is what the DB CHECK and validators enforce.
 */
export const VALID_CATEGORIES = Object.freeze([
  'Ресторан',
  'Кофейня',
  'Кафе',
  'Фаст-фуд',
  'Бар',
  'Кондитерская',
  'Пиццерия',
  'Пекарня',
  'Паб',
  'Столовая',
  'Кальянная',
  'Боулинг',
  'Караоке',
  'Бильярд',
  'Клуб',
]);

/**
 * Canonical cuisine types (12).
 */
export const VALID_CUISINES = Object.freeze([
  'Народная',
  'Авторская',
  'Азиатская',
  'Американская',
  'Вегетарианская',
  'Японская',
  'Грузинская',
  'Итальянская',
  'Смешанная',
  'Европейская',
  'Китайская',
  'Восточная',
]);

/**
 * Canonical establishment attribute keyspace (canon-10, SDL CAT-C-3.15).
 *
 * These are the ONLY attribute keys the bulk-import payload mapper may emit
 * (AF1 import-blocking minimum). The backend write-path does not yet enforce
 * the attribute keyspace (that enforcement is the deferred AF1 reconciliation
 * slice), so a non-canon key would be written silently — authoring the seed
 * config against this frozen set is what keeps the import output clean.
 *
 * Semantics: boolean `true` or key-absent (AND-within-group on the public
 * filter, per public-api.test.js). Never `false` — absence encodes "no".
 */
export const ATTRIBUTE_CANON = Object.freeze([
  'delivery',
  'wifi',
  'terrace',
  'parking',
  'live_music',
  'kids_zone',
  'banquet',
  'pets_allowed',
  'smoking',
  'accessible_environment',
]);

const CATEGORY_SET = new Set(VALID_CATEGORIES);
const CUISINE_SET = new Set(VALID_CUISINES);
const ATTRIBUTE_SET = new Set(ATTRIBUTE_CANON);

/**
 * @param {string} value
 * @returns {boolean} true if value is a canonical category
 */
export const isValidCategory = (value) => CATEGORY_SET.has(value);

/**
 * @param {string} value
 * @returns {boolean} true if value is a canonical cuisine
 */
export const isValidCuisine = (value) => CUISINE_SET.has(value);

/**
 * @param {string} key
 * @returns {boolean} true if key is a canonical attribute key
 */
export const isCanonAttributeKey = (key) => ATTRIBUTE_SET.has(key);
