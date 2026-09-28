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
 * - media with a human touch (hidden by admin, or updated after OCR) are
 *   SKIPPED unless --include-touched;
 * - --apply requires --backup=<file>: every menu_item of the targeted media
 *   (all columns) is written there BEFORE any job is inserted;
 * - media with a pending/processing job are skipped (no double work).
 *
 * Usage:
 *   node scripts/reocr-menus.js                                   # report only
 *   node scripts/reocr-menus.js --backup=<file>                   # report + backup, no writes
 *   node scripts/reocr-menus.js --backup=<file> --apply           # backup, then insert pending jobs
 *   … --statuses=active,draft (default)  … --include-touched
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, writeFileSync } from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';

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
if (apply && !backupPath) { console.error('❌ --apply requires --backup=<file>'); process.exit(1); }

// Mirrors requeue-menu-ocr.js / config/cloudinary.js.
const fileExtension = (url) => {
  const base = String(url || '').split('?')[0];
  const seg = base.slice(base.lastIndexOf('/') + 1);
  const dot = seg.lastIndexOf('.');
  return dot === -1 ? '' : seg.slice(dot + 1).toLowerCase();
};
const OCRABLE_EXTENSIONS = ['', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'jfif'];

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  const media = await client.query(`
    SELECT m.id AS media_id, m.establishment_id, m.url, m.file_type, e.name, e.status,
           (SELECT COUNT(*) FROM menu_items mi WHERE mi.media_id = m.id)::int AS items,
           EXISTS (SELECT 1 FROM menu_items mi WHERE mi.media_id = m.id
                    AND (mi.is_hidden_by_admin OR mi.updated_at > mi.created_at + interval '1 second')) AS touched,
           EXISTS (SELECT 1 FROM ocr_jobs j WHERE j.media_id = m.id
                    AND j.status IN ('pending', 'processing')) AS in_flight
      FROM establishment_media m
      JOIN establishments e ON e.id = m.establishment_id
     WHERE m.type = 'menu' AND e.status = ANY($1)
     ORDER BY e.name, m.position`, [statuses]);

  const targets = [];
  for (const row of media.rows) {
    const reason = !OCRABLE_EXTENSIONS.includes(fileExtension(row.url)) ? 'формат не читается'
      : row.in_flight ? 'задача уже в очереди'
        : row.touched && !includeTouched ? 'есть правки людей (--include-touched)'
          : null;
    if (reason) console.log(`✗ skip  ${row.name} [${row.status}]  media=${row.media_id}  items=${row.items}  — ${reason}`);
    else targets.push(row);
  }

  const byCard = new Map();
  for (const t of targets) {
    const c = byCard.get(t.name) || { status: t.status, media: 0, items: 0 };
    c.media += 1;
    c.items += t.items;
    byCard.set(t.name, c);
  }
  console.log('\nК перераспознаванию:');
  for (const [name, c] of byCard) console.log(`  ${name} [${c.status}] — файлов ${c.media}, позиций сейчас ${c.items}`);
  console.log(`\nИтого: ${targets.length} файлов меню, ${byCard.size} карточек, позиций будет заменено ${targets.reduce((a, t) => a + t.items, 0)}.`);

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
