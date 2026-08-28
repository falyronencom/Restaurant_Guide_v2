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

/**
 * Statuses whose CONTENT is worth a moderator's attention — the establishment is
 * in the catalogue or can return to it.
 *
 * Excluded: 'draft' (never submitted), 'rejected' and 'archived' (never will be).
 * This matters because OCR runs at CREATION — createEstablishment enqueues jobs for
 * menu photos/PDFs while status is still 'draft' (hardcoded in the INSERT). A partner
 * who starts a card, uploads a menu and walks away leaves flagged menu_items behind
 * forever. Counting them tells a moderator to review prices nobody can see and that
 * nobody will publish; the moderator cannot even tell which rows those are, because
 * the establishment status is not on the item.
 *
 * 'suspended' stays IN scope: the card was live and an unsuspend puts it back, so its
 * flagged dishes would return to the catalogue silently if we stopped counting them.
 *
 * Consumers: qualityHealthModel.getHangingFlags (health signal + rail badge +
 * dashboard row) and menuItemModel.getFlaggedItems (the queue itself). They share this
 * list so that the establishment-status axis cannot drift between a badge and the screen
 * it links to.
 *
 * This closes ONE of the two axes, not both. The counting functions also filter
 * `is_hidden_by_admin = FALSE`; getFlaggedItems does not, because the queue has to keep
 * showing hidden items so a moderator can unhide them. Since hiding never clears
 * sanity_flag (adminService.hideMenuItem), that residue is permanent and grows with every
 * hide: a badge reading 12 can open a list of 20. Making the two agree on that axis too
 * means giving getFlaggedItems an explicit hidden-items parameter and a screen header
 * that names its own population — deferred to the "Позиции меню" rebuild (stage 7 pass B),
 * where that screen is redesigned anyway. Until then the client compensates by defaulting
 * its filter to non-hidden.
 */
export const CATALOGUE_TRACK_STATUSES = Object.freeze([
  'active',
  'pending',
  'suspended',
]);
