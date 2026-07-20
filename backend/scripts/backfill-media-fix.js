/**
 * One-off backfill for cards created via the two-stage cabinet flow BEFORE the
 * 2026-07-20 media-sync fix. Repairs two defects in existing prod data:
 *
 *   1. establishments.primary_image_url IS NULL despite having interior media
 *      (the catalog "Нет фото"). → set it from the primary interior photo.
 *   2. menu media whose url is a .pdf but file_type='image' with a RAW .pdf in
 *      preview_url (Cloudinary 401s raw PDF → broken menu <img>). → set
 *      file_type='pdf' + pg_1 JPG preview/thumbnail.
 *
 * Safe: SELECT + targeted UPDATE only, matches the exact bug signature (never
 * touches already-correct rows). Writes a JSON backup before any change.
 *
 * Usage:
 *   node scripts/backfill-media-fix.js                # report only, no writes
 *   node scripts/backfill-media-fix.js --apply        # backup + apply
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

const apply = process.argv.includes('--apply');

/** Insert a pg_1 JPG transform after /upload/ and swap the .pdf extension. Mirrors
 *  the render params curl-verified to return 200 for these PDFs. */
function pdfTransform(url, w, h, crop) {
  return url
    .replace('/upload/', `/upload/pg_1,f_jpg,w_${w},h_${h},c_${crop}/`)
    .replace(/\.pdf(\?|$)/i, '.jpg$1');
}
const isPdfUrl = (url) => url.split('?')[0].toLowerCase().endsWith('.pdf');

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  // ── Defect 1: null primary_image_url with interior media present ──────────
  const nullPrimary = await client.query(`
    SELECT e.id, e.name,
           (SELECT COALESCE(m.preview_url, m.url)
              FROM establishment_media m
             WHERE m.establishment_id = e.id AND m.type = 'interior'
             ORDER BY m.is_primary DESC, m.position ASC
             LIMIT 1) AS new_primary
      FROM establishments e
     WHERE e.primary_image_url IS NULL
       AND EXISTS (SELECT 1 FROM establishment_media m
                    WHERE m.establishment_id = e.id AND m.type = 'interior')
  `);

  // ── Defect 2: menu media typed image but url is a .pdf ────────────────────
  const badPdf = await client.query(`
    SELECT m.id, m.establishment_id, e.name, m.url, m.file_type
      FROM establishment_media m JOIN establishments e ON e.id = m.establishment_id
     WHERE m.type = 'menu' AND m.file_type <> 'pdf' AND m.url ILIKE '%.pdf'
  `);

  console.log('════════════════════════════════════════════════');
  console.log(`  MEDIA BACKFILL — production  (${apply ? 'APPLY' : 'REPORT ONLY'})`);
  console.log('════════════════════════════════════════════════');
  console.log(`\nDefect 1 — null primary_image_url w/ interior media: ${nullPrimary.rows.length} card(s)`);
  for (const r of nullPrimary.rows) console.log(`  - "${r.name}" → primary = ${r.new_primary ? 'set' : '(no interior?)'}`);
  console.log(`\nDefect 2 — menu PDFs mis-typed as image: ${badPdf.rows.length} row(s)`);
  for (const r of badPdf.rows) console.log(`  - "${r.name}" (${r.file_type}) ${r.url.split('/').pop()}`);

  if (!apply) { console.log('\n--report only: no changes. Re-run with --apply to fix.'); await client.end(); return; }

  // Backup the rows about to change.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backendRoot, `backfill-media-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ nullPrimary: nullPrimary.rows, badPdf: badPdf.rows }, null, 2), 'utf8');
  console.log(`\n✅ Backup: ${backupPath}`);

  let p1 = 0;
  for (const r of nullPrimary.rows) {
    if (!r.new_primary) continue;
    await client.query('UPDATE establishments SET primary_image_url = $1, updated_at = NOW() WHERE id = $2', [r.new_primary, r.id]);
    p1++;
  }
  let p2 = 0;
  for (const r of badPdf.rows) {
    if (!isPdfUrl(r.url)) continue;
    await client.query(
      'UPDATE establishment_media SET file_type = $1, preview_url = $2, thumbnail_url = $3 WHERE id = $4',
      ['pdf', pdfTransform(r.url, 800, 600, 'fit'), pdfTransform(r.url, 200, 150, 'fill'), r.id],
    );
    p2++;
  }
  console.log(`\n✅ primary_image_url set on ${p1} card(s); ${p2} menu PDF row(s) re-typed + preview-fixed.`);
  await client.end();
}

main().catch(async (e) => { console.error('❌ Failed:', e.message); try { await client.end(); } catch {} process.exit(1); });
