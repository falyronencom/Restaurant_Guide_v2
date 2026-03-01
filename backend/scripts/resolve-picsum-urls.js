/**
 * Resolve picsum.photos redirect URLs to direct fastly.picsum.photos URLs
 *
 * picsum.photos/seed/N/W/H returns 302 → fastly.picsum.photos/id/X/W/H.jpg
 * CachedNetworkImage on iOS doesn't always handle these redirects.
 * This script resolves all URLs to their final destinations.
 *
 * Usage:
 *   DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD=... \
 *   node backend/scripts/resolve-picsum-urls.js
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

/**
 * Resolve a picsum.photos URL to its final fastly.picsum.photos URL
 */
async function resolveUrl(url) {
  if (!url || !url.includes('picsum.photos/seed/')) return url;

  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual' });
    const location = response.headers.get('location');
    return location || url;
  } catch {
    return url;
  }
}

async function main() {
  console.log('Resolving picsum.photos URLs to direct fastly URLs...\n');

  const client = await pool.connect();

  try {
    // Get all media with picsum URLs
    const mediaResult = await client.query(
      "SELECT id, url, thumbnail_url, preview_url FROM establishment_media WHERE url LIKE '%picsum.photos/seed/%'"
    );

    console.log(`Found ${mediaResult.rows.length} media records to resolve\n`);

    let resolved = 0;
    let failed = 0;

    for (const row of mediaResult.rows) {
      try {
        const [newUrl, newThumb, newPreview] = await Promise.all([
          resolveUrl(row.url),
          resolveUrl(row.thumbnail_url),
          resolveUrl(row.preview_url),
        ]);

        await client.query(
          'UPDATE establishment_media SET url = $1, thumbnail_url = $2, preview_url = $3 WHERE id = $4',
          [newUrl, newThumb, newPreview, row.id]
        );

        resolved++;
        if (resolved % 50 === 0) console.log(`  ... ${resolved} resolved`);
      } catch (err) {
        failed++;
        console.error(`  Failed ${row.id}: ${err.message}`);
      }
    }

    // Also update primary_image_url on establishments
    const estResult = await client.query(
      "SELECT id, primary_image_url FROM establishments WHERE primary_image_url LIKE '%picsum.photos/seed/%'"
    );

    console.log(`\nResolving ${estResult.rows.length} establishment primary_image_url...`);

    for (const row of estResult.rows) {
      try {
        const newUrl = await resolveUrl(row.primary_image_url);
        await client.query(
          'UPDATE establishments SET primary_image_url = $1 WHERE id = $2',
          [newUrl, row.id]
        );
      } catch (err) {
        console.error(`  Failed est ${row.id}: ${err.message}`);
      }
    }

    console.log(`\n✅ Done! Resolved: ${resolved} media, ${estResult.rows.length} primary URLs. Failed: ${failed}`);

    // Show sample
    const sample = await client.query('SELECT url FROM establishment_media LIMIT 1');
    if (sample.rows.length > 0) {
      console.log(`\nSample URL: ${sample.rows[0].url}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
