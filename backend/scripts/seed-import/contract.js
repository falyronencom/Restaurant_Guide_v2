/**
 * Master data-sheet contract — the single authoritative definition of what a
 * collector's CSV must contain, and the values the bulk-import accepts.
 *
 * This is the frozen interface between on-site data collection (CAT-E-2.1) and
 * the import pipeline. It is deliberately strict: the master sheet is the
 * canonical source, so a non-canon value is a collection error to fix in the
 * sheet, never something the importer silently coerces (contrast the migration,
 * which DOES map legacy values — that is for repairing historical DB rows).
 *
 * Hardening decisions encoded here come from the Phase-0 adversarial review:
 *   - exact header whitelist (a typo like `lattitude` must fail loudly, not
 *     silently drop a column);
 *   - `|` as the multi-value separator (ru-Excel exports CSV with `;` as the
 *     field delimiter, so `;` cannot double as an in-field separator);
 *   - phone accepts city codes (+375 17 …), not only the mobile prefixes;
 *   - boolean tokens are a closed whitelist on both sides — an unrecognised
 *     token is an error, never a silent false.
 */

import { VALID_CATEGORIES, VALID_CUISINES, ATTRIBUTE_CANON } from '../../src/constants/establishmentVocab.js';

export { VALID_CATEGORIES, VALID_CUISINES, ATTRIBUTE_CANON };

/**
 * Geographic bounds — mirror of establishmentService.js BELARUS_BOUNDS / CITY_BOUNDS.
 * Duplicated (not imported) on purpose: importing the service pulls in the whole
 * model→DB-pool graph, which would bind the pool at import time BEFORE the CLI
 * resolves its target DB env. These bounds are stable geo constants; a guard test
 * asserts parity with the service so they cannot drift silently.
 */
export const BELARUS_BOUNDS = { LAT_MIN: 51.0, LAT_MAX: 56.0, LON_MIN: 23.0, LON_MAX: 33.0 };

export const CITY_BOUNDS = {
  'Минск': { latMin: 53.75, latMax: 54.10, lonMin: 27.30, lonMax: 27.85 },
  'Гродно': { latMin: 53.55, latMax: 53.78, lonMin: 23.70, lonMax: 24.00 },
  'Брест': { latMin: 51.98, latMax: 52.20, lonMin: 23.55, lonMax: 23.85 },
  'Гомель': { latMin: 52.32, latMax: 52.52, lonMin: 30.85, lonMax: 31.15 },
  'Витебск': { latMin: 55.10, latMax: 55.28, lonMin: 30.05, lonMax: 30.35 },
  'Могилев': { latMin: 53.82, latMax: 54.00, lonMin: 30.20, lonMax: 30.50 },
  'Могилёв': { latMin: 53.82, latMax: 54.00, lonMin: 30.20, lonMax: 30.50 },
  'Бобруйск': { latMin: 53.08, latMax: 53.22, lonMin: 29.10, lonMax: 29.40 },
};

/** House account that owns seed cards until a real partner claims them (CAT-E-2.1). */
export const HOUSE_PARTNER_EMAIL = 'seed.data.generator@restaurantguide.by';

/** Canon-8 cities (both ё/е variants of Mogilev accepted at input). */
export const VALID_CITIES = [
  'Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Могилёв', 'Бобруйск',
];

/** Product-canon price ranges. '$$$$' is DB-legal but out of product scope → rejected. */
export const VALID_PRICE_RANGES = ['$', '$$', '$$$'];

/** Multi-value separator inside categories/cuisines cells. NOT ';' (see header). */
export const MULTIVALUE_SEP = '|';

/** Day columns, in week order. Each holds "HH:MM-HH:MM" or a closed-day token. */
export const HOURS_COLUMNS = [
  'hours_mon', 'hours_tue', 'hours_wed', 'hours_thu', 'hours_fri', 'hours_sat', 'hours_sun',
];

/** working_hours JSONB keys, aligned index-for-index with HOURS_COLUMNS. */
export const HOURS_DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

/** Closed-day tokens (casefolded) → { is_open: false }. */
export const CLOSED_DAY_TOKENS = new Set(['выходной', 'закрыто', 'closed', 'off']);

/** Attribute columns: attr_<canon-key>, exactly the canon-10. Names bake the
 *  canon in, so a non-canon attribute key is structurally impossible to emit. */
export const ATTRIBUTE_COLUMNS = ATTRIBUTE_CANON.map((k) => `attr_${k}`);

/** Boolean cell tokens (casefolded + trimmed). Anything else = hard error. */
export const BOOL_TRUE_TOKENS = new Set(['1', 'да', 'true', 'yes', 'y', '+', 'х', 'x', 'v']);
export const BOOL_FALSE_TOKENS = new Set(['', '0', 'нет', 'false', 'no', 'n', '-']);

/** Required columns (every row must carry a non-empty value, subject to type checks). */
export const REQUIRED_COLUMNS = [
  'stable_id', 'name', 'city', 'address', 'categories', 'cuisines', 'description',
  ...HOURS_COLUMNS,
];

/** Optional columns. Coordinates optional → geocoded when absent. */
export const OPTIONAL_COLUMNS = [
  'latitude', 'longitude', 'price_range', 'phone', 'email', 'website',
  ...ATTRIBUTE_COLUMNS,
];

/** The exact, closed set of permitted headers. Preflight rejects anything else. */
export const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

// ── Field-level patterns ─────────────────────────────────────────────────────

/** stable_id = media folder name (CAT-E-2.1): lowercase slug, 3–64 chars. */
export const STABLE_ID_RE = /^[a-z0-9-]{3,64}$/;

/** Belarus phone incl. city codes (e.g. +375 17 …). Digits only after +375. */
export const PHONE_RE = /^\+375\d{9}$/;

/** Coordinate literal: decimal POINT (never comma), ≥3 fractional digits — blocks
 *  the ru-Excel decimal-comma corruption and integer-truncation classes. */
export const COORD_RE = /^-?\d{1,3}\.\d{3,}$/;

/** Working-hours cell: HH:MM-HH:MM, 24h clock, overnight allowed (close ≤ open). */
export const HOURS_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

// ── Media contract ───────────────────────────────────────────────────────────

/** Media subfolders under <media-root>/<stable_id>/ → establishment_media.type. */
export const MEDIA_TYPES = ['exterior', 'interior', 'dishes', 'menu'];
export const PDF_SUBFOLDER = 'menu_pdf';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB (Cloudinary image ceiling)
export const PDF_MAX_BYTES = 60 * 1024 * 1024; // 60MB (scanned menus)
export const PDF_MAX_COUNT = 2;

/** Per-bucket media caps (mirror backend MEDIA_LIMITS for the photo buckets). */
export const MEDIA_LIMITS = { interior: 30, menu: 30 };

/** CAT-E-2.3 publication minimum (self-enforced — the backend submit-gate does
 *  not check media). Description length is bytes-agnostic char count. */
export const E1_MIN_TOTAL_PHOTOS = 5;
export const E1_MIN_EXTERIOR = 1;
export const E1_DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 2000;

/**
 * City centres for the geocode fallback — real centres, each verified inside the
 * corresponding CITY_BOUNDS box (establishmentService.js). A card that falls back
 * here is jittered (see geocode.js) and flagged coords_source='city_fallback' for
 * post-import coordinate refinement.
 */
export const CITY_CENTERS = {
  'Минск': { latitude: 53.9006, longitude: 27.5590 },
  'Гродно': { latitude: 53.6694, longitude: 23.8131 },
  'Брест': { latitude: 52.0976, longitude: 23.7341 },
  'Гомель': { latitude: 52.4412, longitude: 30.9878 },
  'Витебск': { latitude: 55.1904, longitude: 30.2049 },
  'Могилев': { latitude: 53.9006, longitude: 30.3009 },
  'Могилёв': { latitude: 53.9006, longitude: 30.3009 },
  'Бобруйск': { latitude: 53.1384, longitude: 29.2214 },
};
