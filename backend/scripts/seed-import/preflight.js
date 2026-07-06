/**
 * Preflight — exhaustive validation with ZERO side effects. Nothing is written
 * to the DB or Cloudinary until preflight passes for the whole sheet.
 *
 * Philosophy (Phase-0): the sheet is edited as a single artifact and a re-run is
 * cheap, so preflight collects EVERY error across ALL rows (never fail-fast on
 * the first) and returns a complete report. The operator fixes the sheet and
 * re-runs.
 *
 * Checks:
 *   1. headers == the exact column whitelist (a typo like `lattitude` fails
 *      loudly instead of silently dropping a column);
 *   2. per-row normalization (all single-gate fields: hours/price/desc/phone/…);
 *   3. within-sheet duplicates (stable_id, and case-insensitive name);
 *   4. cross-partner duplicates — name+city against every REAL (non-house)
 *      establishment, since the top-500 Minsk venues overlap the 16 live cards;
 *   5. media folder scan + E1 publication minimum (unless allowIncomplete).
 */

import { normalizeRow, contentHash } from './sheet.js';
import { scanMedia, checkE1 } from './media.js';
import { ALL_COLUMNS, HOUSE_PARTNER_EMAIL } from './contract.js';

/**
 * @param {object} args
 * @param {import('pg').Pool} args.db
 * @param {Array<Record<string,string>>} args.rows - raw CSV rows
 * @param {string[]} args.headers
 * @param {string} args.mediaRoot
 * @param {string} args.housePartnerId
 * @param {boolean} [args.allowIncomplete] - skip the E1 media gate (dry-run only)
 * @returns {Promise<{ ready: Array<{record,mediaItems}>, errors: string[], warnings: string[], stats: object }>}
 */
export async function preflight({ db, rows, headers, mediaRoot, housePartnerId, allowIncomplete = false }) {
  const errors = [];
  const warnings = [];

  // 1. Header whitelist — exact set, no unknowns, no duplicates.
  const seen = new Set();
  for (const h of headers) {
    if (seen.has(h)) errors.push(`duplicate header column: "${h}"`);
    seen.add(h);
    if (!ALL_COLUMNS.includes(h)) errors.push(`unknown header column: "${h}" (not in the contract whitelist)`);
  }
  for (const req of ['stable_id', 'name', 'city', 'address', 'categories', 'cuisines', 'description']) {
    if (!seen.has(req)) errors.push(`missing required column: "${req}"`);
  }
  // A header error means the whole sheet mapping is untrustworthy — stop here.
  if (errors.length) return { ready: [], errors, warnings, stats: { rows: rows.length } };

  // 2. Per-row normalization + media scan + E1.
  const ready = [];
  const stableIds = new Map(); // stable_id → first row#
  const names = new Map();     // lower(name) → first row#

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +1 header, +1 to 1-base
    const { record, errors: rowErrors } = normalizeRow(rows[i], rowNum);
    if (rowErrors.length) { errors.push(...rowErrors); continue; }

    // 3. within-sheet duplicates
    if (stableIds.has(record.stable_id)) {
      errors.push(`row ${rowNum}: duplicate stable_id "${record.stable_id}" (first at row ${stableIds.get(record.stable_id)})`);
      continue;
    }
    stableIds.set(record.stable_id, rowNum);
    const lname = record.name.toLowerCase();
    if (names.has(lname)) {
      errors.push(`row ${rowNum}: duplicate name "${record.name}" (first at row ${names.get(lname)})`);
      continue;
    }
    names.set(lname, rowNum);

    // 5. media scan + E1
    const scan = scanMedia(mediaRoot, record.stable_id);
    if (scan.errors.length) { errors.push(...scan.errors); continue; }
    if (!allowIncomplete) {
      const unmet = checkE1(scan.counts);
      if (unmet.length) { errors.push(`row ${rowNum} (${record.stable_id}): E1 not met — ${unmet.join('; ')}`); continue; }
    }

    record.content_hash = contentHash(record);
    ready.push({ record, mediaItems: scan.items });
  }

  // 4. cross-partner duplicate detection (name+city vs REAL establishments).
  if (ready.length) {
    const lnames = ready.map((r) => r.record.name.toLowerCase());
    const { rows: existing } = await db.query(
      `SELECT e.id, e.name, e.city, e.claimed_at, u.email AS owner_email
       FROM establishments e JOIN users u ON u.id = e.partner_id
       WHERE LOWER(e.name) = ANY($1::text[]) AND e.partner_id <> $2`,
      [lnames, housePartnerId],
    );
    const realByKey = new Map();
    for (const row of existing) realByKey.set(`${row.name.toLowerCase()}|${row.city}`, row);
    for (const { record } of ready) {
      const match = realByKey.get(`${record.name.toLowerCase()}|${record.city}`);
      if (match) {
        errors.push(
          `row (${record.stable_id}): name+city collides with existing real card ` +
          `"${match.name}" (${match.city}, owner ${match.owner_email}` +
          `${match.claimed_at ? ', CLAIMED' : ''}). Default policy: drop the seed row or add a landmark qualifier.`,
        );
      }
    }
  }

  const stats = {
    rows: rows.length,
    ready: ready.length,
    errors: errors.length,
    house_partner_email: HOUSE_PARTNER_EMAIL,
  };
  // If cross-partner collisions were appended, drop those from ready.
  if (errors.some((e) => e.includes('collides with existing real card'))) {
    const collided = new Set(
      errors.filter((e) => e.includes('collides with existing real card'))
        .map((e) => (e.match(/\(([^)]+)\)/) || [])[1]),
    );
    return {
      ready: ready.filter((r) => !collided.has(r.record.stable_id)),
      errors, warnings, stats,
    };
  }
  return { ready, errors, warnings, stats };
}
