/**
 * Sheet normalization — raw CSV row → typed, canonical record (+ per-field
 * errors), and a stable content hash over the normalized form.
 *
 * This is where the "single-gate" fields live (Phase-0 finding: the backend
 * service validates only city/categories/cuisines/geo — hours, price,
 * description, phone, email are checked ONLY here). Normalization is therefore
 * strict: an unparseable value is an error, never a silent default.
 *
 * content_hash is computed over the NORMALIZED record (sorted key=value), not
 * the raw CSV line — so re-saving the sheet in Excel (quoting/CRLF/column-order
 * churn) does not spuriously flip the hash and manufacture false "changed"
 * conflicts on re-run.
 */

import crypto from 'crypto';
import {
  VALID_CITIES, VALID_PRICE_RANGES, MULTIVALUE_SEP,
  HOURS_COLUMNS, HOURS_DAY_KEYS, CLOSED_DAY_TOKENS,
  ATTRIBUTE_CANON, ATTRIBUTE_COLUMNS,
  BOOL_TRUE_TOKENS, BOOL_FALSE_TOKENS,
  STABLE_ID_RE, PHONE_RE, COORD_RE, HOURS_RE,
  VALID_CATEGORIES, VALID_CUISINES,
  E1_DESCRIPTION_MIN, DESCRIPTION_MAX,
} from './contract.js';

const casefold = (s) => (s ?? '').trim().toLowerCase();

/** Parse a boolean cell. Returns true | false | undefined(=error). */
function parseBool(raw) {
  const t = casefold(raw);
  if (BOOL_TRUE_TOKENS.has(t)) return true;
  if (BOOL_FALSE_TOKENS.has(t)) return false;
  return undefined;
}

/** Split a multi-value cell on '|', trimming and dropping empties. */
function splitMulti(raw) {
  return (raw ?? '')
    .split(MULTIVALUE_SEP)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Normalize one raw row into a typed record.
 * @param {Record<string,string>} raw
 * @param {number} rowNum - 1-based sheet row (for error messages)
 * @returns {{ record: object|null, errors: string[] }}
 */
export function normalizeRow(raw, rowNum) {
  const errors = [];
  const err = (m) => errors.push(`row ${rowNum}: ${m}`);
  const rec = { raw };

  // stable_id
  rec.stable_id = (raw.stable_id ?? '').trim();
  if (!STABLE_ID_RE.test(rec.stable_id)) {
    err(`stable_id "${rec.stable_id}" invalid (need ^[a-z0-9-]{3,64}$)`);
  }

  // name
  rec.name = (raw.name ?? '').trim();
  if (!rec.name) err('name is required');
  else if (rec.name.length > 255) err('name exceeds 255 chars');

  // city (canon-8, ё/е both)
  rec.city = (raw.city ?? '').trim();
  if (!VALID_CITIES.includes(rec.city)) err(`city "${rec.city}" is not a canon city`);

  // address
  rec.address = (raw.address ?? '').trim();
  if (!rec.address) err('address is required');
  else if (rec.address.length > 500) err('address exceeds 500 chars');

  // coordinates (optional; strict format — no decimal comma, no bare integer)
  rec.latitude = null;
  rec.longitude = null;
  const latRaw = (raw.latitude ?? '').trim();
  const lonRaw = (raw.longitude ?? '').trim();
  if (latRaw || lonRaw) {
    if (!COORD_RE.test(latRaw) || !COORD_RE.test(lonRaw)) {
      err(`coordinates "${latRaw},${lonRaw}" must be decimal-point with ≥3 fractional digits (comma/integers rejected)`);
    } else {
      rec.latitude = parseFloat(latRaw);
      rec.longitude = parseFloat(lonRaw);
    }
  }

  // categories (1-2, strict canon-Cyrillic)
  rec.categories = splitMulti(raw.categories);
  if (rec.categories.length < 1 || rec.categories.length > 2) {
    err(`categories must have 1-2 values (got ${rec.categories.length})`);
  }
  const badCats = rec.categories.filter((c) => !VALID_CATEGORIES.includes(c));
  if (badCats.length) err(`non-canon categories: ${badCats.join(', ')}`);

  // cuisines (1-3, strict canon-Cyrillic)
  rec.cuisines = splitMulti(raw.cuisines);
  if (rec.cuisines.length < 1 || rec.cuisines.length > 3) {
    err(`cuisines must have 1-3 values (got ${rec.cuisines.length})`);
  }
  const badCuis = rec.cuisines.filter((c) => !VALID_CUISINES.includes(c));
  if (badCuis.length) err(`non-canon cuisines: ${badCuis.join(', ')}`);

  // price_range (optional; product canon)
  const price = (raw.price_range ?? '').trim();
  rec.price_range = price || null;
  if (price && !VALID_PRICE_RANGES.includes(price)) {
    err(`price_range "${price}" not in ${VALID_PRICE_RANGES.join('/')}`);
  }

  // description (required; E1 length is enforced here as single-gate)
  rec.description = (raw.description ?? '').trim();
  if (rec.description.length < E1_DESCRIPTION_MIN) {
    err(`description ${rec.description.length} chars < ${E1_DESCRIPTION_MIN} (E1 minimum)`);
  } else if (rec.description.length > DESCRIPTION_MAX) {
    err(`description exceeds ${DESCRIPTION_MAX} chars`);
  }

  // phone / email / website (optional)
  const phone = (raw.phone ?? '').trim();
  rec.phone = phone || null;
  if (phone && !PHONE_RE.test(phone)) err(`phone "${phone}" not +375XXXXXXXXX (9 digits)`);

  const email = (raw.email ?? '').trim().toLowerCase();
  rec.email = email || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(`email "${email}" malformed`);

  rec.website = (raw.website ?? '').trim() || null;

  // working_hours (7 columns → JSONB); strict format; all-closed = error
  rec.working_hours = {};
  let openDays = 0;
  for (let d = 0; d < HOURS_COLUMNS.length; d++) {
    const cell = (raw[HOURS_COLUMNS[d]] ?? '').trim();
    const dayKey = HOURS_DAY_KEYS[d];
    if (CLOSED_DAY_TOKENS.has(casefold(cell))) {
      rec.working_hours[dayKey] = { is_open: false };
    } else if (HOURS_RE.test(cell)) {
      rec.working_hours[dayKey] = cell;
      openDays++;
    } else {
      err(`${HOURS_COLUMNS[d]} "${cell}" must be HH:MM-HH:MM or a closed-day token`);
    }
  }
  if (openDays === 0 && errors.length === 0) err('all seven days are closed');

  // attributes (canon-10 columns → { key: true }; false/absent → key omitted)
  rec.attributes = {};
  for (let a = 0; a < ATTRIBUTE_COLUMNS.length; a++) {
    const col = ATTRIBUTE_COLUMNS[a];
    if (!(col in raw)) continue; // optional column absent from sheet
    const v = parseBool(raw[col]);
    if (v === undefined) {
      err(`${col} "${raw[col]}" is not a recognised yes/no token`);
    } else if (v === true) {
      rec.attributes[ATTRIBUTE_CANON[a]] = true;
    }
  }

  return { record: errors.length ? null : rec, errors };
}

/**
 * Stable content hash over the normalized record. Deterministic: sorted keys,
 * canonical JSON of the meaningful fields (excludes `raw` and derived coords
 * source). Used to detect real sheet edits vs. cosmetic re-saves.
 * @param {object} rec - a normalized record (from normalizeRow)
 * @returns {string} sha256 hex
 */
export function contentHash(rec) {
  const canonical = {
    stable_id: rec.stable_id,
    name: rec.name,
    city: rec.city,
    address: rec.address,
    latitude: rec.latitude,
    longitude: rec.longitude,
    categories: [...rec.categories],
    cuisines: [...rec.cuisines],
    price_range: rec.price_range,
    description: rec.description,
    phone: rec.phone,
    email: rec.email,
    website: rec.website,
    working_hours: rec.working_hours,
    attributes: Object.keys(rec.attributes).sort().reduce((o, k) => { o[k] = rec.attributes[k]; return o; }, {}),
  };
  return crypto.createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/** Deterministic JSON.stringify with sorted object keys at every depth. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
