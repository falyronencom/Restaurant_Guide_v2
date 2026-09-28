/**
 * Ground-truth scorer CLI — scores harness runs against the human-verified
 * ground truth. Rules, stitching and the anti-Goodhart counters: scorer.js.
 *
 * No network, no database, no API key — reads files, writes two files.
 *
 * Usage:
 *   node scripts/ocr-benchmark/score.js --run=scripts/ocr-benchmark/runs/<run>
 *   node scripts/ocr-benchmark/score.js --run=<dirA>,<dirB> --models=a,b --gt=<ground-truth.json> --out=<prefix>
 *
 * Flags:
 *   --run=<dir>[,<dir>…]  harness run dir(s); each must hold results.json
 *   --models=a,b          score only these `model` labels (default: every model of the run, run order)
 *   --gt=<file>           ground truth (default: runs/2026-07-27_163128/ground-truth.json next to this script)
 *   --out=<prefix>        writes <prefix>.json and <prefix>.md (default: <first run>/gt-score)
 *
 * Anchor: on runs/2026-07-27_163128 the model google/gemini-2.5-flash must
 * score names 474 / prices 409 / categories 363 / all three 332 of 480 with
 * 0 lost and 0 added — the ground truth's `model` column IS that run.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { scoreModel, describeGroundTruth, buildScoreMarkdown } from './scorer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GT = join(__dirname, 'runs', '2026-07-27_163128', 'ground-truth.json');

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    if (i === -1) args[a.slice(2)] = true;
    else args[a.slice(2, i)] = a.slice(i + 1);
  }
  return args;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.run || args.run === true) fail('--run=<dir>[,<dir>…] is required');

  const gtPath = resolve(args.gt && args.gt !== true ? String(args.gt) : DEFAULT_GT);
  if (!existsSync(gtPath)) fail(`ground truth not found: ${gtPath}`);
  const gt = readJson(gtPath);

  const runs = list(args.run).map((d) => {
    const dir = resolve(d);
    const file = join(dir, 'results.json');
    if (!existsSync(file)) fail(`results.json not found in ${dir}`);
    return { dir, runId: basename(dir), results: readJson(file) };
  });
  const multi = runs.length > 1;
  const wanted = args.models && args.models !== true ? new Set(list(args.models)) : null;

  const scores = [];
  for (const run of runs) {
    const models = [...new Set(run.results.map((r) => r.model))].filter((m) => !wanted || wanted.has(m));
    for (const model of models) {
      const s = scoreModel({ gt, results: run.results, model });
      s.label = multi ? `${model} · ${run.runId}` : model;
      s.runId = run.runId;
      scores.push(s);
    }
  }
  if (scores.length === 0) fail('nothing to score — check --models against the `model` labels in results.json');

  const generatedAt = new Date().toISOString();
  const meta = {
    generatedAt,
    gtPath,
    gt: describeGroundTruth(gt),
    runs: runs.map((r) => ({ dir: r.dir, runId: r.runId })),
  };
  const prefix = resolve(args.out && args.out !== true ? String(args.out) : join(runs[0].dir, 'gt-score'));
  writeFileSync(`${prefix}.json`, JSON.stringify({ ...meta, scores }, null, 2), 'utf8');
  const md = buildScoreMarkdown(meta, scores);
  writeFileSync(`${prefix}.md`, md, 'utf8');

  for (const s of scores) {
    const a = s.accuracy;
    const f = (m) => `${m.ok}/${m.total} (${m.pct == null ? '—' : m.pct.toFixed(1)}%)`;
    console.log(`${s.label}: items ${s.run.items} · stitched ${s.stitching.stitched} (lenient ${s.stitching.lenient}, same-name ${s.stitching.ambiguous}) · LOST ${s.stitching.lost} · added ${s.stitching.added}`);
    console.log(`  names ${f(a.name)} · lenient ${f(a.nameLenient)} · prices ${f(a.price)} · categories ${f(a.category)} · all three ${f(a.allThree)} · errors ${s.run.errors.length}`);
    if (s.run.photosOutsideGroundTruth.length) {
      console.warn(`  ⚠ ${s.run.photosOutsideGroundTruth.length} run photo(s) not in the ground truth: ${s.run.photosOutsideGroundTruth.slice(0, 5).join(', ')}`);
    }
    if (s.run.photos > 0 && s.run.photosMatched === 0) {
      console.warn('  ⚠ no run photo matches a ground-truth photo by name — «all lost» here means «wrong file names» (--media-root gives <stable_id>/file)');
    }
  }
  console.log(`\nWritten: ${prefix}.md, ${prefix}.json`);
}

main();
