/**
 * Seed bulk-import CLI (CAT-C-3.5 amendment / CAT-E-2.1/2.2).
 *
 * Produces active seed cards from a master CSV + stable-ID media folders, via the
 * edge-immune backend service layer. Idempotent + resumable (registry phase
 * machine). See README.md for the full contract and runbook.
 *
 * Target DB is selected explicitly and resolved into DB_* env vars BEFORE the
 * service layer is dynamically imported, so both the app pool and the registry
 * bind to the intended database.
 *
 * Usage:
 *   node scripts/seed-import/index.js --target=dryrun  --sheet=<csv> --media-root=<dir> [--media-mode=stub] [--allow-incomplete]
 *   node scripts/seed-import/index.js --target=prod    --sheet=<csv> --media-root=<dir> --batch-id=<id> --yes
 *   node scripts/seed-import/index.js --target=prod    --report-only --sheet=<csv> --media-root=<dir>
 *   node scripts/seed-import/index.js --target=prod    --rollback-batch=<id> --yes
 */

import { existsSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { HOUSE_PARTNER_EMAIL } from './contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? true : v;
    } else args._.push(a);
  }
  return args;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/** Resolve the target DB into process.env.DB_* (+ NODE_ENV for SSL). Returns info. */
function resolveTarget(args) {
  const target = args.target;
  if (!['dryrun', 'local', 'prod'].includes(target)) {
    fail('--target must be one of: dryrun | local | prod');
  }

  if (target === 'dryrun') {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_NAME = args['db-name'] || 'seed_dryrun';
    process.env.DB_USER = process.env.DB_USER || 'postgres';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
    delete process.env.NODE_ENV; // no SSL locally
    return { target, host: process.env.DB_HOST, db: process.env.DB_NAME };
  }

  if (target === 'local') {
    // Use the dev .env (config/database.js loads it). Nothing to set here.
    return { target, host: process.env.DB_HOST || 'localhost(.env)', db: process.env.DB_NAME || '(.env)' };
  }

  // prod — parse DATABASE_URL from backend/.env.production, enable SSL.
  const envPath = join(__dirname, '../../.env.production');
  if (!existsSync(envPath)) fail('backend/.env.production not found (needs DATABASE_URL for --target=prod)');
  const line = readFileSync(envPath, 'utf8').split('\n').find((l) => l.trim().startsWith('DATABASE_URL='));
  if (!line) fail('DATABASE_URL not set in backend/.env.production');
  const url = new URL(line.slice(line.indexOf('=') + 1).trim());
  process.env.DB_HOST = url.hostname;
  process.env.DB_PORT = url.port || '5432';
  process.env.DB_NAME = url.pathname.replace(/^\//, '');
  process.env.DB_USER = decodeURIComponent(url.username);
  process.env.DB_PASSWORD = decodeURIComponent(url.password);
  process.env.NODE_ENV = 'production'; // SSL on
  return { target, host: url.hostname, db: process.env.DB_NAME };
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${question} (yes/no): `, (a) => {
    rl.close();
    resolve(a.trim().toLowerCase() === 'yes');
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const info = resolveTarget(args);
  const isLocalHost = ['localhost', '127.0.0.1'].includes(info.host);

  const mediaMode = args['media-mode'] || 'real';
  const allowIncomplete = !!args['allow-incomplete'];
  const rollbackBatchId = args['rollback-batch'];

  // ── Guards (target-keyed, NOT NODE_ENV — the real run env has no NODE_ENV) ──
  if (mediaMode === 'stub' && info.target !== 'dryrun') {
    fail('--media-mode=stub is only allowed with --target=dryrun (stub URLs must never reach a real DB)');
  }
  if (allowIncomplete) {
    const dbLooksDryrun = /dryrun/i.test(info.db);
    if (info.target !== 'dryrun' || !isLocalHost || !dbLooksDryrun) {
      fail('--allow-incomplete requires --target=dryrun on a local *dryrun* database — refusing (guards the E1 gate on real data)');
    }
  }
  if (['real', undefined].includes(args['media-mode']) && info.target === 'dryrun' && !rollbackBatchId) {
    console.warn('⚠ --target=dryrun with real media mode will hit Cloudinary. Use --media-mode=stub for the synthetic dry-run.');
  }

  // prod confirmation (unless --yes).
  if (info.target === 'prod' && !args.yes) {
    console.log(`Target: PROD  host=${info.host}  db=${info.db}`);
    const action = rollbackBatchId ? `ROLLBACK batch ${rollbackBatchId}` : 'IMPORT';
    if (!(await confirm(`This will ${action} against PRODUCTION. Continue?`))) fail('aborted by operator');
  }

  const cfg = {
    sheetPath: args.sheet,
    mediaRoot: args['media-root'],
    batchId: args['batch-id'] || `import-${Date.now()}`,
    housePartnerEmail: args['house-email'] || HOUSE_PARTNER_EMAIL,
    mediaMode,
    allowIncomplete,
    reportOnly: !!args['report-only'],
    geocodeDisabled: !!args['geocode-disabled'],
    geocodeCacheFile: args['geocode-cache'] || join(__dirname, '.geocode-cache.json'),
    rollbackBatchId,
    snapshotFile: args['snapshot'] || join(__dirname, `rollback-snapshot-${rollbackBatchId || 'x'}.json`),
    forceWithInteractions: !!args['force-with-interactions'],
  };

  if (!rollbackBatchId) {
    if (!cfg.sheetPath || !existsSync(cfg.sheetPath)) fail(`--sheet not found: ${cfg.sheetPath}`);
    if (!cfg.mediaRoot || !existsSync(cfg.mediaRoot)) fail(`--media-root not found: ${cfg.mediaRoot}`);
  }

  console.log(`Target ${info.target} · host ${info.host} · db ${info.db} · batch ${cfg.batchId} · media ${mediaMode}${allowIncomplete ? ' · allow-incomplete' : ''}`);

  // Dynamic import AFTER env is set, so the app pool binds to the resolved DB.
  const { run } = await import('./run.js');
  const summary = await run(cfg);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.blocked ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
