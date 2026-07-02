/**
 * Quality Health Model — AI-ops Brick-1 (Tier-0 quality immunity, read-only).
 *
 * Read-only aggregate queries that lift the seed-import Acceptance criteria into a
 * standing health signal: canon/slug-reachability, menu completeness, geo bounds,
 * working-hours sanity, attribute-key census, and hanging OCR flags.
 *
 * Zero LLM, zero writes, zero new tables (CAT-F-3 heterogeneity). All signals are
 * scoped to status='active' — the live public surface the sitemap/catalog expose
 * and the seed import publishes.
 *
 * Reuse-not-invent: canon lists, slug helpers and geo bounds are imported from
 * their single sources of truth (urlSlugs.js, establishmentService.js), never
 * duplicated — so the monitor can never silently diverge from what it measures.
 *
 * Tables queried: establishments, establishment_media, menu_items, ocr_jobs.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';
import {
  cityCyrillicToSlug,
  categoryCyrillicToSlug,
  CATEGORY_SLUG_MAP,
  CUISINE_SLUG_MAP,
} from '../constants/urlSlugs.js';
import { BELARUS_BOUNDS, validateCityCoordinates } from '../services/establishmentService.js';
import { checkWorkingHours } from '../utils/workingHoursSanity.js';

// Bound the per-signal sample lists returned for admin drill-down.
const SAMPLE_LIMIT = 25;

// Canon = keys of the URL slug maps (single source; equals VALID_CATEGORIES /
// VALID_CUISINES in establishmentService by construction, per urlSlugs.js header).
const CATEGORY_CANON = Object.keys(CATEGORY_SLUG_MAP);
const CUISINE_CANON = Object.keys(CUISINE_SLUG_MAP);

// ============================================================================
// A1 — slug reachability (runtime reuse of the projection helpers)
// ============================================================================

/**
 * Active establishments whose primary category or city yields a null slug — silently
 * dropped from the sitemap (sitemap.ts null-skip) and unreachable via catalog browse.
 * Rows are run through the SAME slug helpers the projection uses
 * (establishmentProjections.js), so this count can never diverge from the sitemap.
 */
export const getUnreachableEstablishments = async () => {
  const query = `
    SELECT id, name, city, categories
    FROM establishments
    WHERE status = 'active'
  `;
  try {
    const { rows } = await pool.query(query);
    let count = 0;
    const samples = [];
    for (const row of rows) {
      const primaryCategory = Array.isArray(row.categories) && row.categories.length > 0
        ? row.categories[0]
        : null;
      const citySlug = cityCyrillicToSlug(row.city);
      const categorySlug = categoryCyrillicToSlug(primaryCategory);
      if (!citySlug || !categorySlug) {
        count += 1;
        if (samples.length < SAMPLE_LIMIT) {
          samples.push({
            id: row.id,
            name: row.name,
            city: row.city,
            primary_category: primaryCategory,
            city_slug: citySlug,
            category_slug: categorySlug,
          });
        }
      }
    }
    return { count, samples };
  } catch (error) {
    logger.error('Error computing unreachable establishments', { error: error.message });
    throw error;
  }
};

// ============================================================================
// A2 — canon membership (SQL unnest anti-membership)
// ============================================================================

/**
 * Active establishments carrying ANY category outside the 15-canon or ANY cuisine
 * outside the 12-canon. Covers secondary categories and cuisines (which A1 does not —
 * cuisines never appear in URLs). Canon passed as a parameter, never inlined.
 */
export const getOffCanonCounts = async () => {
  const query = `
    SELECT
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM unnest(categories) c WHERE c <> ALL($1::varchar[]))
      )::int AS category_offcanon_count,
      COUNT(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM unnest(cuisines) cu WHERE cu <> ALL($2::varchar[]))
      )::int AS cuisine_offcanon_count
    FROM establishments
    WHERE status = 'active'
  `;
  try {
    const { rows } = await pool.query(query, [CATEGORY_CANON, CUISINE_CANON]);
    return rows[0];
  } catch (error) {
    logger.error('Error computing off-canon counts', { error: error.message });
    throw error;
  }
};

// ============================================================================
// B — menu completeness (anti-join + OCR job health)
// ============================================================================

/**
 * B1: active establishments with menu media (PDF or type='menu' photo) but zero
 * menu_items AND no in-flight OCR job — OCR has drained and produced nothing. A
 * 0-item OCR marks the job 'done', so only this anti-join catches it; the in-flight
 * guard suppresses transient false positives during the import window.
 * B2: OCR job health — failed / stuck (pending after a first attempt).
 */
export const getMenuCompleteness = async () => {
  const emptyMenusQuery = `
    SELECT e.id, e.name, e.city, COUNT(*) OVER()::int AS total_count
    FROM establishments e
    WHERE e.status = 'active'
      AND EXISTS (
        SELECT 1 FROM establishment_media m
        WHERE m.establishment_id = e.id
          AND (m.file_type = 'pdf' OR (m.file_type = 'image' AND m.type = 'menu'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM menu_items mi WHERE mi.establishment_id = e.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM ocr_jobs j
        WHERE j.establishment_id = e.id AND j.status IN ('pending', 'processing')
      )
    ORDER BY e.created_at DESC
    LIMIT $1
  `;
  const jobHealthQuery = `
    SELECT
      COUNT(*) FILTER (WHERE status = 'failed')::int AS ocr_failed_count,
      COUNT(*) FILTER (WHERE status = 'pending' AND attempts > 0)::int AS ocr_stuck_count
    FROM ocr_jobs
  `;
  try {
    const [emptyResult, jobHealth] = await Promise.all([
      pool.query(emptyMenusQuery, [SAMPLE_LIMIT]),
      pool.query(jobHealthQuery),
    ]);
    const emptyCount = emptyResult.rows.length > 0 ? emptyResult.rows[0].total_count : 0;
    return {
      empty_menus_count: emptyCount,
      empty_menus_samples: emptyResult.rows.map((r) => ({ id: r.id, name: r.name, city: r.city })),
      ocr_failed_count: jobHealth.rows[0].ocr_failed_count,
      ocr_stuck_count: jobHealth.rows[0].ocr_stuck_count,
    };
  } catch (error) {
    logger.error('Error computing menu completeness', { error: error.message });
    throw error;
  }
};

// ============================================================================
// C — geo bounds (reuse validateCityCoordinates + BELARUS_BOUNDS)
// ============================================================================

/**
 * Active establishments whose coordinates fall outside Belarus or outside their
 * declared city's bbox. Reuses the exact checks createEstablishment enforces on
 * write, applied as a standing read. Coords are numeric → pg returns strings → parseFloat.
 */
export const getOutOfBoundsEstablishments = async () => {
  const query = `
    SELECT id, name, city, latitude, longitude
    FROM establishments
    WHERE status = 'active'
  `;
  try {
    const { rows } = await pool.query(query);
    let count = 0;
    const samples = [];
    for (const row of rows) {
      const lat = parseFloat(row.latitude);
      const lon = parseFloat(row.longitude);
      const inBelarus = Number.isFinite(lat) && Number.isFinite(lon)
        && lat >= BELARUS_BOUNDS.LAT_MIN && lat <= BELARUS_BOUNDS.LAT_MAX
        && lon >= BELARUS_BOUNDS.LON_MIN && lon <= BELARUS_BOUNDS.LON_MAX;
      const cityCheck = validateCityCoordinates(row.city, lat, lon);
      if (!inBelarus || !cityCheck.valid) {
        count += 1;
        if (samples.length < SAMPLE_LIMIT) {
          samples.push({
            id: row.id,
            name: row.name,
            city: row.city,
            latitude: lat,
            longitude: lon,
            reason: !inBelarus ? 'outside_belarus' : 'city_mismatch',
          });
        }
      }
    }
    return { count, samples };
  } catch (error) {
    logger.error('Error computing out-of-bounds establishments', { error: error.message });
    throw error;
  }
};

// ============================================================================
// D — working-hours sanity (malformed / all-closed)
// ============================================================================

/**
 * Active establishments with structurally broken or fully-closed working_hours.
 * Uses checkWorkingHours (deterministic format check; NOT staleness — no timestamp
 * exists; NOT open>=close — overnight spans are valid).
 */
export const getInvalidHours = async () => {
  const query = `
    SELECT id, name, city, working_hours
    FROM establishments
    WHERE status = 'active'
  `;
  try {
    const { rows } = await pool.query(query);
    let malformedCount = 0;
    let allClosedCount = 0;
    const samples = [];
    for (const row of rows) {
      const { malformed, allClosed } = checkWorkingHours(row.working_hours);
      if (malformed || allClosed) {
        if (malformed) malformedCount += 1;
        if (allClosed) allClosedCount += 1;
        if (samples.length < SAMPLE_LIMIT) {
          samples.push({
            id: row.id,
            name: row.name,
            city: row.city,
            malformed,
            all_closed: allClosed,
          });
        }
      }
    }
    return { malformed_count: malformedCount, all_closed_count: allClosedCount, samples };
  } catch (error) {
    logger.error('Error computing invalid working hours', { error: error.message });
    throw error;
  }
};

// ============================================================================
// E — attribute-key census (census, NOT pass/fail)
// ============================================================================

/**
 * Key-frequency census over active establishments' attributes JSONB. The canon-10
 * attribute keyset is ratified but not yet reconciled in code (divergent writers,
 * unchecked write path), so v1 observes rather than enforces — this census is the
 * input the AF1 reconciliation slice needs. jsonb_object_keys is guarded so a folded
 * array/number/null never errors; those rows are counted separately as a signal.
 */
export const getAttributeKeyCensus = async () => {
  const censusQuery = `
    SELECT key, COUNT(*)::int AS count
    FROM establishments e
    CROSS JOIN LATERAL jsonb_object_keys(
      CASE WHEN jsonb_typeof(e.attributes) = 'object' THEN e.attributes ELSE '{}'::jsonb END
    ) AS key
    WHERE e.status = 'active'
    GROUP BY key
    ORDER BY count DESC, key ASC
  `;
  const nonObjectQuery = `
    SELECT COUNT(*)::int AS count
    FROM establishments
    WHERE status = 'active' AND jsonb_typeof(attributes) IS DISTINCT FROM 'object'
  `;
  try {
    const [census, nonObject] = await Promise.all([
      pool.query(censusQuery),
      pool.query(nonObjectQuery),
    ]);
    return {
      keys: census.rows,
      non_object_count: nonObject.rows[0].count,
    };
  } catch (error) {
    logger.error('Error computing attribute key census', { error: error.message });
    throw error;
  }
};

// ============================================================================
// F — hanging OCR flags (reuse getFlaggedItems predicate)
// ============================================================================

/**
 * menu_items flagged by the OCR sanity checker that no moderator has actioned:
 * sanity_flag still set (dismiss-flag clears it) AND not hidden. Age buckets surface
 * a draining backlog.
 */
export const getHangingFlags = async () => {
  const query = `
    SELECT
      COUNT(*)::int AS hanging_count,
      COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '7 days')::int AS aged_over_7d,
      COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '30 days')::int AS aged_over_30d
    FROM menu_items
    WHERE sanity_flag IS NOT NULL AND is_hidden_by_admin = FALSE
  `;
  try {
    const { rows } = await pool.query(query);
    return rows[0];
  } catch (error) {
    logger.error('Error computing hanging flags', { error: error.message });
    throw error;
  }
};

// ============================================================================
// G — price distribution anomalies (STATISTICAL — deferred stub)
// ============================================================================

/**
 * Statistical signal deferred to the real-500 import (statistics need a population).
 * Absolute per-item price outliers are already caught at OCR time by sanity_flag.
 * Stubbed so the response contract stays stable.
 */
export const getPriceDistributionAnomalies = async () => ({
  status: 'deferred',
  reason: 'statistical signal — wire at real-500 import',
});
