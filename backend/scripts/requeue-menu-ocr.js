/**
 * One-off OCR requeue for menu media that never entered the OCR pipeline.
 *
 * Root cause (fixed 2026-07-20): OcrJobModel.enqueue existed only in
 * createEstablishment, while cabinet cards add menus via the two-stage flow
 * (POST without media → autosave PUT media-sync) — so no cabinet-added menu
 * ever got an ocr_jobs row (MARBL). This script backfills jobs for existing
 * menu media that have NO ocr_jobs row at all; the prod worker picks them up.
 *
 * Skips media whose url extension is outside the serving allow-list (e.g. the
 * MARKS .ai) — OCR cannot read them; they need a re-upload by the owner.
 *
 * Safe: SELECT + INSERT only (no updates/deletes); mirrors the enqueue model's
 * idempotency (skips media with any existing job — pending, processing, done
 * or failed; failed retries stay the worker's policy, not this script's).
 *
 * Usage:
 *   node scripts/requeue-menu-ocr.js            # report only, no writes
 *   node scripts/requeue-menu-ocr.js --apply    # insert pending jobs
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
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

const apply = process.argv.includes('--apply');

// Mirrors config/cloudinary.js: extension of the last path segment, '' for the
// canonical extension-less delivery URL (valid image).
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

  const orphans = await client.query(`
    SELECT m.id AS media_id, m.establishment_id, m.url, m.file_type, e.name
      FROM establishment_media m
      JOIN establishments e ON e.id = m.establishment_id
     WHERE m.type = 'menu'
       AND NOT EXISTS (SELECT 1 FROM ocr_jobs j WHERE j.media_id = m.id)
     ORDER BY e.name, m.position
  `);

  if (orphans.rows.length === 0) {
    console.log('✅ No menu media without OCR jobs — nothing to requeue.');
    return;
  }

  const enqueueable = [];
  for (const row of orphans.rows) {
    const ext = fileExtension(row.url);
    const ok = OCRABLE_EXTENSIONS.includes(ext);
    console.log(
      `${ok ? '→ requeue' : '✗ skip (bad format)'}  ${row.name}  ` +
      `media=${row.media_id}  file_type=${row.file_type}  ext=${ext || '(none)'}`,
    );
    if (ok) enqueueable.push(row);
  }

  console.log(`\n${orphans.rows.length} orphan menu media, ${enqueueable.length} enqueueable.`);

  if (!apply) {
    console.log('Dry run — re-run with --apply to insert pending OCR jobs.');
    return;
  }

  for (const row of enqueueable) {
    await client.query(
      `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts)
       VALUES ($1, $2, 'pending', 0)`,
      [row.establishment_id, row.media_id],
    );
    console.log(`✅ enqueued  ${row.name}  media=${row.media_id}`);
  }
  console.log(`\n✅ ${enqueueable.length} OCR job(s) inserted — prod worker will pick them up.`);
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => client.end());
