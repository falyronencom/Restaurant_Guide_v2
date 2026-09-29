/**
 * OCR model benchmark CLI (pilot prep — DIRECTIVE_benchmark 2026-07-12).
 *
 * Runs local menu photos through N candidate OpenRouter models using the
 * EXACT production extraction pipeline semantics (vision OCR → LLM structurer
 * → sanity checker, equal prompts imported from src/) and writes side-by-side
 * dumps + SUMMARY.md for the empirical AI_OCR_MODEL choice BEFORE the pilot
 * import drains with the winner.
 *
 * No database access of any kind — file dumps only. Production untouched.
 *
 * Usage:
 *   node scripts/ocr-benchmark/index.js --photos=<dir>                    # flat folder of images
 *   node scripts/ocr-benchmark/index.js --media-root=<dir>                # seed-import contract (<stable_id>/menu/*)
 *   node scripts/ocr-benchmark/index.js --photos=<dir> --models=a,b,c --limit=3
 *   node scripts/ocr-benchmark/index.js --list-models                     # catalog verification only, no key needed
 *
 * Flags:
 *   --photos=<dir>      flat folder of menu images (jpg/jpeg/png/webp)
 *   --media-root=<dir>  seed-import media root; only <stable_id>/menu/* is read
 *   --models=a,b,c      override the default candidate set; a plain id sends what production
 *                       sends (getOcrConfig().reasoning), id@default sends no reasoning field,
 *                       id@<none|minimal|low|medium|high> sends that effort — both calls
 *   --limit=N           cap the number of photos (smoke runs)
 *   --out=<dir>         output dir (default: scripts/ocr-benchmark/runs/<timestamp>)
 *   --text-from=<dir>   structurer only: take each photo's text from that run's dump of the
 *                       same model label instead of calling vision — a structurer prompt is
 *                       compared on the same text, at half the price
 *   --list-models       verify candidates against the OpenRouter catalog and exit
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load backend/.env explicitly (path-anchored, cwd-independent). dotenv never
// overwrites vars already present in the environment.
dotenv.config({ path: join(__dirname, '../../.env') });

import { DEFAULT_MODELS, parseModelSpec, fetchCatalog, verifyModels, computeCostUsd } from './models.js';
import { discoverPhotos } from './discover.js';
import { toDataUri, visionExtract, structureText } from './caller.js';
import { writeManifest, writeDump, writeResults, buildSummary, writeSummary, readSavedVision } from './report.js';
import { check as sanityCheck } from '../../src/services/ocr/sanityChecker.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const i = a.indexOf('=');
      if (i === -1) args[a.slice(2)] = true;
      else args[a.slice(2, i)] = a.slice(i + 1);
    } else args._.push(a);
  }
  return args;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/** Local-time, filename-safe run id (e.g. 2026-07-13_142530). */
function runTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let requestedModels = DEFAULT_MODELS;
  if (args.models !== undefined) {
    if (args.models === true) fail('--models requires a value: --models=id1,id2,…');
    requestedModels = String(args.models).split(',').map((s) => s.trim()).filter(Boolean);
    if (requestedModels.length === 0) fail('--models is empty');
  }

  let specs;
  try {
    specs = requestedModels.map(parseModelSpec);
  } catch (e) {
    fail(e.message);
  }

  // ── Catalog verification (also serves --list-models) ──────────────────────
  console.log('Verifying candidates against the OpenRouter catalog…');
  const catalog = await fetchCatalog();
  if (!catalog) {
    console.warn('⚠ OpenRouter catalog unreachable — running unverified, cost fallback unavailable.');
  }
  const { usable, skipped } = verifyModels(specs, catalog);
  for (const s of skipped) console.warn(`⚠ skipping ${s.id}: ${s.reason}`);
  for (const u of usable) {
    const price = u.pricing ? `$${u.pricing.prompt}/tok in, $${u.pricing.completion}/tok out` : 'pricing unknown';
    console.log(`  ✔ ${u.spec} (${price})`);
  }
  if (args['list-models']) return;
  if (usable.length === 0) fail('no usable candidate models');

  // ── Inputs ─────────────────────────────────────────────────────────────────
  const mediaRoot = args['media-root'] ? resolve(String(args['media-root'])) : undefined;
  const photosDir = args.photos ? resolve(String(args.photos)) : undefined;
  if (!mediaRoot && !photosDir) fail('provide --photos=<dir> and/or --media-root=<dir>');
  if (mediaRoot && !existsSync(mediaRoot)) fail(`--media-root not found: ${mediaRoot}`);
  if (photosDir && !existsSync(photosDir)) fail(`--photos not found: ${photosDir}`);

  let textFrom = null;
  if (args['text-from'] !== undefined) {
    if (args['text-from'] === true) fail('--text-from requires a value: --text-from=<run dir>');
    textFrom = resolve(String(args['text-from']));
    if (!existsSync(join(textFrom, 'dumps'))) fail(`--text-from has no dumps/: ${textFrom}`);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    fail('OPENROUTER_API_KEY is empty — set it in backend/.env (a local/dev key is fine; the harness never touches prod)');
  }

  const { units: allUnits, warnings } = discoverPhotos({ mediaRoot, photosDir });
  let limit = Infinity;
  if (args.limit !== undefined) {
    limit = parseInt(String(args.limit), 10);
    if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a positive integer');
  }
  const units = allUnits.slice(0, limit);
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (units.length === 0) fail('no benchmark photos found');
  console.log(`Photos: ${units.length}${allUnits.length !== units.length ? ` (of ${allUnits.length}, --limit)` : ''} · Models: ${usable.length} · Calls ≈ ${units.length * usable.length * (textFrom ? 1 : 2)}${textFrom ? ` · text from ${textFrom}` : ''}`);

  // ── Run ────────────────────────────────────────────────────────────────────
  const startedAt = runTimestamp();
  const runDir = args.out ? resolve(String(args.out)) : join(__dirname, 'runs', startedAt);
  if (args.out && existsSync(join(runDir, 'dumps'))) {
    console.warn('⚠ --out already contains dumps from a previous run — stale dumps will sit beside fresh ones unless every model×photo pair is regenerated. Prefer a clean dir.');
  }
  // A run label is the spec (id@effort) — dumps, SUMMARY and the scorer keep
  // «as production» and «with an effort» of one model apart.
  const pricingByModel = new Map(usable.map((u) => [u.spec, u.pricing]));
  const specBy = new Map(usable.map((u) => [u.spec, u]));
  const models = usable.map((u) => u.spec);

  writeManifest(runDir, {
    startedAt,
    models,
    skippedModels: skipped,
    photos: units.map((u) => ({ id: u.id, bytes: u.bytes })),
    sources: { mediaRoot: mediaRoot || null, photosDir: photosDir || null, textFrom },
  });

  const results = [];
  for (const model of models) {
    const { id: modelId, effort } = specBy.get(model);
    console.log(`\n=== ${model} ===`);
    for (const unit of units) {
      const result = {
        unitId: unit.id,
        model,
        modelId,
        reasoningEffort: effort ?? 'production',
        vision: { ms: null, usage: null, rawTextChars: 0, confidenceHeuristic: null, rawText: '', attempts: null },
        structurer: { ms: null, usage: null, parseOk: null, zodOk: null, zodError: null, attempts: null },
        items: [],
        metrics: { itemsCount: 0, needsCaution: 0, empty: true, costUsd: null },
        error: null,
      };
      let stage = 'vision';
      try {
        // A saved text costs nothing now: usage and ms stay null, so cost
        // and latency count the structurer alone.
        const vision = textFrom
          ? { ...readSavedVision(textFrom, model, unit.id), usage: null, ms: null, attempts: 0 }
          : await visionExtract([toDataUri(unit.abspath, unit.mime)], modelId, effort);
        result.vision = {
          ms: vision.ms,
          usage: vision.usage,
          rawTextChars: vision.rawText.length,
          confidenceHeuristic: vision.confidenceHeuristic,
          rawText: vision.rawText,
          attempts: vision.attempts,
          sentReasoning: vision.sentReasoning,
          finishReason: vision.finishReason,
          ...(textFrom && { textFrom }),
        };

        stage = 'structurer';
        const structured = await structureText(vision.rawText, modelId, effort);
        result.structurer = {
          ms: structured.ms,
          usage: structured.usage,
          parseOk: structured.parseOk,
          zodOk: structured.zodOk,
          zodError: structured.zodError,
          attempts: structured.attempts,
          sentReasoning: structured.sentReasoning,
        };

        // Production sanity rules on equal footing; no previous items on a
        // first import, so the price-delta rule is naturally inert.
        result.items = sanityCheck(structured.items, []);
        const needsCaution = result.items.filter((i) => i.sanity_flag != null).length;
        const pricing = pricingByModel.get(model);
        const visionCost = computeCostUsd(vision.usage, pricing);
        const structCost = computeCostUsd(structured.usage, pricing);
        const costs = [visionCost, structCost].filter((c) => c != null);
        result.metrics = {
          itemsCount: result.items.length,
          needsCaution,
          empty: result.items.length === 0,
          costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
        };
      } catch (e) {
        result.error = e.message;
        // Only a failed call carries attempts; a later throw (sanity, cost)
        // must not wipe what the structurer already recorded.
        if (e.attempts != null) result[stage].attempts = e.attempts;
        // Spend already incurred before the failure still counts — recompute
        // cost from whatever usage blocks were captured, so SUMMARY totals
        // reflect real money, not just error-free rows.
        const pricing = pricingByModel.get(model);
        const costs = [
          computeCostUsd(result.vision.usage, pricing),
          computeCostUsd(result.structurer.usage, pricing),
        ].filter((c) => c != null);
        if (costs.length) result.metrics.costUsd = costs.reduce((a, b) => a + b, 0);
      }

      try {
        writeDump(runDir, result);
      } catch (e) {
        // A dump-write failure must not kill the run (the result still lands
        // in results.json at the end) — flag it and move on.
        result.error = result.error || `dump write failed: ${e.message}`;
        console.warn(`  ⚠ dump write failed for ${unit.id}: ${e.message}`);
      }
      const status = result.error
        ? `ERR ${result.error.slice(0, 120)}`
        : `${result.metrics.itemsCount} items${result.metrics.needsCaution ? ` (⚠${result.metrics.needsCaution})` : ''} · ${(result.vision.ms || 0) + (result.structurer.ms || 0)}ms`;
      console.log(`  ${unit.id}: ${status}`);
      results.push(result);
    }
  }

  // ── Artifacts ──────────────────────────────────────────────────────────────
  writeResults(runDir, results);
  const summaryMd = buildSummary(
    {
      startedAt,
      photoCount: units.length,
      sources: [mediaRoot && `media-root: ${mediaRoot}`, photosDir && `photos: ${photosDir}`].filter(Boolean),
      skippedModels: skipped,
      warnings,
    },
    models,
    results,
  );
  writeSummary(runDir, summaryMd);

  console.log(`\nDone. Artifacts: ${runDir}`);
  console.log('Read SUMMARY.md first; per-call dumps in dumps/<model>/. Manual hallucination pass is yours.');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
