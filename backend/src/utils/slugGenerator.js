/**
 * Slug Generator Utility
 *
 * Generates URL-safe slugs from establishment names for Phase A web platform
 * (city/category/slug routing per CAT-C decision). Backend-internal; mobile
 * continues to use numeric establishment.id for all API calls.
 *
 * Transliteration approach:
 *   BGN/PCGN-inspired custom map chosen over GOST 7.79-2000 System B for URL
 *   readability. Targets Belarusian Russian-speaking users — natural Latin
 *   spellings (kh, ts, shch) preferred over strict GOST (h, c, shh).
 *
 * Collision handling:
 *   Auto-suffix pattern: kafe-vesna → kafe-vesna-2 → kafe-vesna-3 → ...
 *   Suffix counter applied AFTER truncation, so resulting slug stays
 *   ≤ MAX_SLUG_LENGTH even when base is at the limit.
 */

import logger from './logger.js';

const MAX_SLUG_LENGTH = 150;
const MAX_COLLISION_ATTEMPTS = 10000;

/**
 * Cyrillic → Latin transliteration map.
 * Multi-character results (yo, zh, kh, ts, ch, sh, shch, yu, ya) are
 * handled by string concatenation in transliterate().
 *
 * Belarusian-specific letters (ў, і) follow BGN/PCGN: ў→u, і→i.
 * Uppercase Ў/І are handled via toLowerCase() in transliterate().
 */
const TRANSLITERATION_MAP = {
  'а': 'a',  'б': 'b',  'в': 'v',  'г': 'g',  'д': 'd',
  'е': 'e',  'ё': 'yo', 'ж': 'zh', 'з': 'z',  'и': 'i',
  'й': 'y',  'к': 'k',  'л': 'l',  'м': 'm',  'н': 'n',
  'о': 'o',  'п': 'p',  'р': 'r',  'с': 's',  'т': 't',
  'у': 'u',  'ф': 'f',  'х': 'kh', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y',  'ь': '',
  'э': 'e',  'ю': 'yu', 'я': 'ya',
  'і': 'i',  'ў': 'u',
};

/**
 * Transliterate Cyrillic characters to Latin equivalents.
 *
 * Latin characters pass through with original case preserved (case is
 * normalized later in normalizeSlug). Non-mapped characters (digits,
 * punctuation, other scripts) pass through and are filtered by normalize.
 *
 * @param {string} text - Source text
 * @returns {string} Transliterated text
 */
export const transliterate = (text) => {
  if (!text) return '';
  let result = '';
  for (const char of text) {
    const lower = char.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(TRANSLITERATION_MAP, lower)) {
      result += TRANSLITERATION_MAP[lower];
    } else {
      result += char;
    }
  }
  return result;
};

/**
 * Normalize text into URL-safe slug format.
 *
 * Steps:
 *   1. lowercase
 *   2. replace any non-alphanumeric sequence with single '-'
 *   3. collapse consecutive '-' (defensive — step 2 should have caught it)
 *   4. trim leading/trailing '-'
 *
 * @param {string} text - Pre-transliterated text
 * @returns {string} URL-safe slug (may be empty for pure-punctuation input)
 */
export const normalizeSlug = (text) => {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Truncate slug to maxLength, preferring to break at the last '-' boundary.
 *
 * If the last '-' falls in the first half of the truncated region, hard-
 * truncates instead (avoids losing too much content). Threshold: 50% of
 * maxLength.
 *
 * @param {string} slug - Source slug
 * @param {number} [maxLength=MAX_SLUG_LENGTH] - Maximum allowed length
 * @returns {string} Truncated slug ≤ maxLength
 */
export const truncateSlug = (slug, maxLength = MAX_SLUG_LENGTH) => {
  if (slug.length <= maxLength) return slug;
  const truncated = slug.substring(0, maxLength);
  const lastDash = truncated.lastIndexOf('-');
  if (lastDash > maxLength * 0.5) {
    return truncated.substring(0, lastDash);
  }
  return truncated;
};

/**
 * Generate a slug from a name (pure function — no I/O, no collision check).
 *
 * Pipeline: transliterate → normalize → truncate.
 * For uniqueness, use generateUniqueSlug.
 *
 * @param {string} name - Source name
 * @returns {string} Generated slug (empty if name has no slug-able content)
 */
export const generateSlug = (name) => {
  if (!name) return '';
  const transliterated = transliterate(name);
  const normalized = normalizeSlug(transliterated);
  return truncateSlug(normalized);
};

/**
 * Generate a unique slug, resolving collisions via numeric suffix.
 *
 * Algorithm:
 *   1. Generate base slug from name
 *   2. Check if base is free → return immediately
 *   3. Otherwise, append -2, -3, -4, ... until checkDuplicate returns false
 *
 * Suffix counter is added AFTER truncation. If base is at MAX_SLUG_LENGTH,
 * base is re-truncated to make room for the suffix string.
 *
 * @param {string} name - Source name
 * @param {(slug: string) => Promise<boolean>} checkDuplicate - returns true
 *   if the slug is already in use, false if available
 * @returns {Promise<string>} Unique slug
 * @throws {Error} If name produces empty slug, or no free slot found in
 *   MAX_COLLISION_ATTEMPTS attempts
 */
export const generateUniqueSlug = async (name, checkDuplicate) => {
  const baseSlug = generateSlug(name);
  if (!baseSlug) {
    throw new Error(`Cannot generate slug from name: "${name}"`);
  }

  if (!(await checkDuplicate(baseSlug))) {
    return baseSlug;
  }

  for (let suffix = 2; suffix <= MAX_COLLISION_ATTEMPTS; suffix++) {
    const suffixStr = `-${suffix}`;
    const maxBaseLength = MAX_SLUG_LENGTH - suffixStr.length;
    const adjustedBase = baseSlug.length > maxBaseLength
      ? truncateSlug(baseSlug, maxBaseLength)
      : baseSlug;
    const candidate = `${adjustedBase}${suffixStr}`;

    if (!(await checkDuplicate(candidate))) {
      logger.warn('Slug collision resolved via auto-suffix', {
        name,
        baseSlug,
        finalSlug: candidate,
        attempts: suffix - 1,
      });
      return candidate;
    }
  }

  throw new Error(
    `Failed to find unique slug after ${MAX_COLLISION_ATTEMPTS} attempts for name: "${name}"`,
  );
};
