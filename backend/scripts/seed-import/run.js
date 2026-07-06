/**
 * Orchestrator — wires the modules and runs the import (or report-only pass).
 *
 * Imported DYNAMICALLY by index.js AFTER the target DB env is set, so the app
 * pool (config/database.js) and the service/model layer all bind to the intended
 * database. All per-card work is sequential — the Phase-0 review calls for
 * bounded Cloudinary concurrency, and sequential is the simplest safe choice for
 * a one-shot ~500 run.
 */

import { readFileSync } from 'fs';
import { pool } from '../../src/config/database.js';
import * as service from '../../src/services/establishmentService.js';
import * as MediaModel from '../../src/models/mediaModel.js';
import * as OcrJobModel from '../../src/models/ocrJobModel.js';
import { deleteImage } from '../../src/config/cloudinary.js';
import { parseCsv } from './csv.js';
import { preflight } from './preflight.js';
import { processCard } from './pipeline.js';
import { Geocoder } from './geocode.js';
import { rollbackBatch } from './rollback.js';

async function resolveHousePartnerId(email) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!rows[0]) throw new Error(`house partner account not found: ${email}`);
  return rows[0].id;
}

/**
 * @param {object} cfg
 * @param {string} cfg.sheetPath
 * @param {string} cfg.mediaRoot
 * @param {string} cfg.batchId
 * @param {string} cfg.housePartnerEmail
 * @param {'real'|'stub'} cfg.mediaMode
 * @param {boolean} cfg.allowIncomplete
 * @param {boolean} cfg.reportOnly
 * @param {boolean} cfg.geocodeDisabled
 * @param {string} cfg.geocodeCacheFile
 * @param {string} [cfg.rollbackBatchId]
 * @param {string} [cfg.snapshotFile]
 * @param {boolean} [cfg.forceWithInteractions]
 * @param {(msg:string)=>void} [cfg.log]
 * @returns {Promise<object>} summary
 */
export async function run(cfg) {
  const log = cfg.log || ((m) => console.log(m));
  try {
    // ── Rollback mode ────────────────────────────────────────────────────────
    if (cfg.rollbackBatchId) {
      const result = await rollbackBatch({
        db: pool,
        batchId: cfg.rollbackBatchId,
        snapshotFile: cfg.snapshotFile,
        destroy: (publicId) => deleteImage(publicId),
        forceWithInteractions: cfg.forceWithInteractions,
      });
      log(`Rollback ${cfg.rollbackBatchId}: ${JSON.stringify(result)}`);
      return result;
    }

    // ── Import / report-only ──────────────────────────────────────────────────
    const housePartnerId = await resolveHousePartnerId(cfg.housePartnerEmail);
    const text = readFileSync(cfg.sheetPath, 'utf8');
    const { headers, rows, delimiter } = parseCsv(text);
    log(`Parsed ${rows.length} rows (delimiter '${delimiter}', ${headers.length} columns).`);

    const pf = await preflight({
      db: pool, rows, headers,
      mediaRoot: cfg.mediaRoot,
      housePartnerId,
      allowIncomplete: cfg.allowIncomplete,
    });

    log(`Preflight: ${pf.ready.length} ready, ${pf.errors.length} error(s), ${pf.warnings.length} warning(s).`);
    if (pf.errors.length) {
      log('── Preflight errors ──');
      for (const e of pf.errors.slice(0, 200)) log(`  ✗ ${e}`);
      if (pf.errors.length > 200) log(`  … and ${pf.errors.length - 200} more`);
    }
    for (const w of pf.warnings) log(`  ⚠ ${w}`);

    if (cfg.reportOnly || pf.errors.length) {
      return { phase: 'preflight', ...pf.stats, errors: pf.errors.length, ready: pf.ready.length, blocked: pf.errors.length > 0 };
    }

    // ── Import run ─────────────────────────────────────────────────────────────
    const geocoder = new Geocoder({ cacheFile: cfg.geocodeCacheFile, disabled: cfg.geocodeDisabled });
    const ctx = {
      db: pool, service, MediaModel, OcrJobModel, geocoder,
      partnerId: housePartnerId, batchId: cfg.batchId, mediaMode: cfg.mediaMode,
    };

    const tally = { created: 0, resumed: 0, skipped: 0, conflict: 0, failed: 0 };
    const failures = [];
    const conflicts = [];
    const t0 = Date.now();

    for (let i = 0; i < pf.ready.length; i++) {
      const { record, mediaItems } = pf.ready[i];
      try {
        const res = await processCard(ctx, record, mediaItems);
        tally[res.status]++;
        if (res.status === 'conflict') conflicts.push(record.stable_id);
        if ((i + 1) % 25 === 0) log(`  … ${i + 1}/${pf.ready.length} (${JSON.stringify(tally)})`);
      } catch (e) {
        tally.failed++;
        failures.push({ stable_id: record.stable_id, error: e.message });
        log(`  ✗ ${record.stable_id}: ${e.message}`);
      }
    }
    geocoder.saveCache();
    const elapsedMs = Date.now() - t0;

    const summary = {
      phase: 'import',
      batch_id: cfg.batchId,
      total_ready: pf.ready.length,
      ...tally,
      conflicts,
      failures,
      geocode: geocoder.stats,
      elapsed_ms: elapsedMs,
      per_card_ms: pf.ready.length ? Math.round(elapsedMs / pf.ready.length) : 0,
    };
    log(`── Import complete ── ${JSON.stringify({ ...tally, elapsed_ms: elapsedMs })}`);
    if (conflicts.length) log(`  ⚠ ${conflicts.length} post-activation content_hash conflict(s) (sheet edited): ${conflicts.join(', ')}`);
    return summary;
  } finally {
    await pool.end();
  }
}
