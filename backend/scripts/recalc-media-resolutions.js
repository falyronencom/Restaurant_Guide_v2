/**
 * One-off recalc of delivery-variant URLs after the 2026-07-20 resolution
 * uplift (preview 800×600→w1200, thumbnail 200×150→400×300, no height cap on
 * originals/previews).
 *
 * Existing establishment_media rows carry variant URLs baked with the OLD
 * parameters; new parameters only apply to new uploads. This recalculates:
 *   - image media:  preview_url + thumbnail_url (from public_id parsed out of url)
 *   - pdf media:    preview_url + thumbnail_url (pg_1 helpers)
 *   - establishments.primary_image_url (from the primary interior's new preview)
 *
 * The `url` column is NEVER touched: PUT media-sync diffs buckets by m.url —
 * rewriting it would make every open client form's next autosave delete+reinsert
 * all media. For already-compressed masters the new original transform is a
 * no-op anyway; full quality returns via re-upload (pilot decision).
 *
 * Safe: SELECT + targeted UPDATE of variant columns; JSON backup written
 * before any change. The backup holds establishment_media rows only —
 * old primary_image_url values are recoverable from the backed-up previews.
 *
 * Usage:
 *   node scripts/recalc-media-resolutions.js            # report only
 *   node scripts/recalc-media-resolutions.js --apply    # backup + apply
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

// Import AFTER dotenv so cloudinary.config() picks up the production cloud name.
const {
  extractPublicIdFromUrl,
  generateImageUrl,
  generatePdfThumbnailUrl,
  generatePdfPreviewUrl,
} = await import('../src/config/cloudinary.js');

const apply = process.argv.includes('--apply');
const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  const media = await client.query(`
    SELECT m.id, m.establishment_id, m.type, m.file_type, m.url,
           m.thumbnail_url, m.preview_url, e.name
      FROM establishment_media m
      JOIN establishments e ON e.id = m.establishment_id
     ORDER BY e.name, m.type, m.position
  `);

  const plan = [];
  const skipped = [];
  for (const row of media.rows) {
    const publicId = extractPublicIdFromUrl(row.url);
    if (!publicId) { skipped.push({ ...row, reason: 'public_id unparseable' }); continue; }

    const next = row.file_type === 'pdf'
      ? {
        thumbnail_url: generatePdfThumbnailUrl(publicId),
        preview_url: generatePdfPreviewUrl(publicId),
      }
      : {
        thumbnail_url: generateImageUrl(publicId, 'thumbnail'),
        preview_url: generateImageUrl(publicId, 'preview'),
      };

    if (next.thumbnail_url === row.thumbnail_url && next.preview_url === row.preview_url) continue;
    plan.push({ row, next });
    console.log(`→ ${row.name}  ${row.type}/${row.file_type}  media=${row.id}`);
    // Eyeball samples: the first rows print old→new so a bad public_id parse
    // is visible BEFORE --apply.
    if (plan.length <= 2) {
      console.log(`    old preview: ${row.preview_url}`);
      console.log(`    new preview: ${next.preview_url}`);
    }
  }

  for (const s of skipped) {
    console.log(`✗ skip  ${s.name}  media=${s.id}  (${s.reason})`);
  }
  console.log(`\n${media.rows.length} media rows, ${plan.length} to update, ${skipped.length} skipped.`);

  if (!apply) {
    console.log('Dry run — re-run with --apply to write.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backendRoot, `media-resolutions-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(media.rows, null, 2));
  console.log(`\n💾 Backup: ${backupPath}`);

  for (const { row, next } of plan) {
    await client.query(
      'UPDATE establishment_media SET thumbnail_url = $1, preview_url = $2 WHERE id = $3',
      [next.thumbnail_url, next.preview_url, row.id],
    );
  }
  console.log(`✅ ${plan.length} media row(s) updated.`);

  // Re-point catalog covers at the recalculated previews (setPrimaryPhoto
  // semantics: COALESCE(preview_url, url) of the primary interior photo).
  const covers = await client.query(`
    UPDATE establishments e
       SET primary_image_url = COALESCE(m.preview_url, m.url)
      FROM (
        SELECT DISTINCT ON (establishment_id)
               establishment_id, preview_url, url
          FROM establishment_media
         WHERE type = 'interior'
         ORDER BY establishment_id, is_primary DESC NULLS LAST, position ASC
      ) m
     WHERE m.establishment_id = e.id
       AND e.primary_image_url IS DISTINCT FROM COALESCE(m.preview_url, m.url)
    RETURNING e.name
  `);
  console.log(`✅ primary_image_url refreshed for ${covers.rowCount} establishment(s): ${covers.rows.map(r => r.name).join(', ') || '—'}`);
}

main()
  .catch((err) => { console.error('❌', err.message); process.exitCode = 1; })
  .finally(() => client.end());
