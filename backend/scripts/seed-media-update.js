/**
 * Seed Media Update Script
 *
 * Updates primary_image_url for existing establishments that have NULL images.
 * Uses placeholder images from Unsplash for realistic restaurant/cafe photos.
 *
 * Usage:
 *   node backend/scripts/seed-media-update.js           # Update all with NULL
 *   node backend/scripts/seed-media-update.js --status draft  # Only drafts
 *   node backend/scripts/seed-media-update.js --dry-run       # Preview only
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

/**
 * Curated Unsplash photo IDs for restaurant/cafe images
 * These are high-quality, free-to-use images
 */
const RESTAURANT_PHOTOS = [
  // Restaurant interiors
  'photo-1517248135467-4c7edcad34c4', // Modern restaurant
  'photo-1552566626-52f8b828add9', // Cozy cafe
  'photo-1514933651103-005eec06c04b', // Bar interior
  'photo-1559339352-11d035aa65de', // Fine dining
  'photo-1466978913421-dad2ebd01d17', // Casual restaurant
  'photo-1554118811-1e0d58224f24', // Coffee shop
  'photo-1559329007-40df8a9345d8', // Elegant restaurant
  'photo-1560053608-13721e0d69e8', // Modern cafe
  'photo-1537047902294-62a40c20a6ae', // Restaurant bar
  'photo-1550966871-3ed3cdb5ed0c', // Outdoor dining
  // Food & cuisine focused
  'photo-1504674900247-0877df9cc836', // Food plating
  'photo-1540189549336-e6e99c3679fe', // Pasta dish
  'photo-1565299624946-b28f40a0ae38', // Pizza
  'photo-1567620905732-2d1ec7ab7445', // Breakfast
  'photo-1565958011703-44f9829ba187', // Dessert
  // Coffee & drinks
  'photo-1495474472287-4d71bcdd2085', // Coffee
  'photo-1509042239860-f550ce710b93', // Latte art
  'photo-1544145945-f90425340c7e', // Bar drinks
  // More restaurant interiors
  'photo-1555396273-367ea4eb4db5', // Busy restaurant
  'photo-1571024373940-b2ade63b2a8b', // Kitchen view
  'photo-1578474846511-04ba529f0b88', // Asian restaurant
  'photo-1564759224907-65b945ff0e84', // Italian restaurant
  'photo-1579027989536-b7b1f875659b', // Steakhouse
  'photo-1544148103-0773bf10d330', // Sushi bar
  'photo-1428515613728-6b4607e44363', // French bistro
];

/**
 * Generate Unsplash URL with optimal parameters for restaurant cards
 */
function getUnsplashUrl(photoId, width = 800, height = 600) {
  return `https://images.unsplash.com/${photoId}?w=${width}&h=${height}&fit=crop&auto=format&q=80`;
}

/**
 * Simple hash function to convert UUID string to a number
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get random photo URL, ensuring variety by using establishment ID as seed
 */
function getPhotoForEstablishment(establishmentId) {
  const hash = hashCode(String(establishmentId));
  const index = hash % RESTAURANT_PHOTOS.length;
  return getUnsplashUrl(RESTAURANT_PHOTOS[index]);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    status: null,
  };

  const statusIndex = args.indexOf('--status');
  if (statusIndex !== -1 && args[statusIndex + 1]) {
    options.status = args[statusIndex + 1];
  }

  return options;
}

/**
 * Main update function
 */
async function updatePrimaryImages() {
  const options = parseArgs();

  console.log('📸 Restaurant Guide Belarus - Media Update Script\n');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN (no changes)' : 'UPDATE'}`);
  if (options.status) {
    console.log(`Filter: status = '${options.status}'`);
  }
  console.log('');

  let client;

  try {
    client = await pool.connect();
    console.log('✓ Database connection established\n');

    // Build query to find establishments needing images
    let whereClause = 'WHERE primary_image_url IS NULL';
    const queryParams = [];

    if (options.status) {
      queryParams.push(options.status);
      whereClause += ` AND status = $${queryParams.length}`;
    }

    // Count establishments to update
    const countResult = await client.query(
      `SELECT COUNT(*) as count FROM establishments ${whereClause}`,
      queryParams
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    if (totalCount === 0) {
      console.log('✓ No establishments with NULL primary_image_url found.');
      console.log('  All establishments already have images!\n');
      return;
    }

    console.log(`📊 Found ${totalCount} establishments without primary images\n`);

    // Get establishments to update
    const selectResult = await client.query(
      `SELECT id, name, city, status
       FROM establishments
       ${whereClause}
       ORDER BY id`,
      queryParams
    );

    if (options.dryRun) {
      console.log('🔍 DRY RUN - Would update these establishments:\n');
      selectResult.rows.forEach((row, index) => {
        const photoUrl = getPhotoForEstablishment(row.id);
        console.log(`  ${index + 1}. ${row.name} (${row.city}) [${row.status}]`);
        console.log(`     → ${photoUrl}\n`);
      });
      console.log('\n✓ Dry run complete. No changes made.');
      console.log('  Run without --dry-run to apply changes.\n');
      return;
    }

    // Begin transaction
    await client.query('BEGIN');

    console.log('🔄 Updating establishments:\n');

    let updatedCount = 0;

    for (const row of selectResult.rows) {
      const photoUrl = getPhotoForEstablishment(row.id);

      await client.query(
        'UPDATE establishments SET primary_image_url = $1 WHERE id = $2',
        [photoUrl, row.id]
      );

      updatedCount++;
      console.log(`  ✓ ${updatedCount}/${totalCount}: ${row.name} (${row.city})`);
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`\n✅ Successfully updated ${updatedCount} establishments!\n`);

    // Show summary
    const summaryResult = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(primary_image_url) as with_image,
        COUNT(CASE WHEN primary_image_url IS NULL THEN 1 END) as without_image
      FROM establishments
    `);

    const summary = summaryResult.rows[0];
    console.log('📊 Summary:');
    console.log(`  Total establishments: ${summary.total}`);
    console.log(`  With images: ${summary.with_image}`);
    console.log(`  Without images: ${summary.without_image}`);
    console.log('');

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }

    console.error('\n❌ Update failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

// Execute
updatePrimaryImages().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
