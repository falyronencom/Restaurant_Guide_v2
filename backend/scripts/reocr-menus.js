/**
 * Re-OCR of already recognized menus — after a model change (2026-09-28:
 * google/gemini-3.8-flash replaced 2.5-flash; July menus may carry 2.5-flash-lite
 * or 3.1-flash-lite output). Inserts one pending ocr_jobs row per menu media;
 * the prod worker does the rest.
 *
 * What the worker does to each media (ocrService.processJob): replaceForMedia
 * DELETEs every menu_item of the media and INSERTs the new output — partner
 * edits and admin hides on that media are gone, and sanityChecker compares new
 * prices with the old ones (a >3× change is flagged price_delta_anomaly and
 * lands in the moderation queue). The partner of each card gets one
 * «menu parsed» push per settled batch. Hence:
 * - media with a human touch are SKIPPED unless --include-touched: an item
 *   hidden by admin now, or updated after OCR where the last change is an
 *   unhide (a partner may have edited it before the hide) or has no audit
 *   entry to explain it (likely a partner edit). An item whose last change
 *   is a dismissed sanity flag is not touched (Coordinator, 2026-09-29) — the
 *   rule, its 1 s window and the principle it rests on live in
 *   reocr-menus/plan.js, which also prints the report;
 * - --apply requires --backup=<file>: every menu_item of the targeted media
 *   (all columns) is written there BEFORE any job is inserted;
 * - media with a pending/processing job are skipped (no double work).
 *
 * Usage:
 *   node scripts/reocr-menus.js                                   # report only
 *   node scripts/reocr-menus.js --backup=<file>                   # report + backup, no writes
 *   node scripts/reocr-menus.js --backup=<file> --apply           # backup, then insert pending jobs
 *   … --statuses=active,draft (default)  … --include-touched
 *   … --media=<id>[,<id>…]   only these menu files (e.g. one card after a prompt change)
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, writeFileSync } from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { formatPlan, onlyMedia, planReocr } from './reocr-menus/plan.js';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');
const envPath = join(backendRoot, '.env.production');
if (!existsSync(envPath)) { console.error('❌ Missing backend/.env.production'); process.exit(1); }
dotenv.config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const apply = process.argv.includes('--apply');
const includeTouched = process.argv.includes('--include-touched');
const backupPath = arg('backup');
const statuses = (arg('statuses') || 'active,draft').split(',').map((s) => s.trim()).filter(Boolean);
const mediaIds = arg('media')?.split(',').map((s) => s.trim()).filter(Boolean);
if (mediaIds && mediaIds.length === 0) { console.error('❌ --media is empty'); process.exit(1); }
if (apply && !backupPath) { console.error('❌ --apply requires --backup=<file>'); process.exit(1); }

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  const fullPlan = await planReocr(client, { statuses, includeTouched });
  const plan = mediaIds ? onlyMedia(fullPlan, mediaIds) : fullPlan;
  if (mediaIds) console.log(`Только файлы --media: ${mediaIds.join(', ')}
`);
  console.log(formatPlan(plan));
  const { targets } = plan;

  if (backupPath) {
    const ids = targets.map((t) => t.media_id);
    const items = await client.query('SELECT * FROM menu_items WHERE media_id = ANY($1) ORDER BY media_id, position', [ids]);
    writeFileSync(resolve(backupPath), JSON.stringify({
      takenAt: new Date().toISOString(), statuses, includeTouched, media: targets, menuItems: items.rows,
    }, null, 2), 'utf8');
    console.log(`💾 backup: ${items.rows.length} menu_items of ${ids.length} media → ${resolve(backupPath)}`);
  }

  if (!apply) {
    console.log('Dry run — re-run with --backup=<file> --apply to insert pending OCR jobs.');
    return;
  }

  for (const t of targets) {
    await client.query(
      `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts) VALUES ($1, $2, 'pending', 0)`,
      [t.establishment_id, t.media_id],
    );
  }
  console.log(`\n✅ ${targets.length} OCR job(s) inserted — the prod worker will pick them up.`);
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => client.end());
