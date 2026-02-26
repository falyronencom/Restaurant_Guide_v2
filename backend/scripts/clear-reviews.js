/**
 * Clear Seed Reviews & Users Script
 *
 * Removes all seed reviews and seed user accounts without affecting
 * manually created data. Recalculates establishment aggregates after cleanup.
 *
 * Usage:
 *   node backend/scripts/clear-reviews.js           # Interactive confirmation
 *   node backend/scripts/clear-reviews.js --force    # Skip confirmation
 *
 * Identifies seed data by email pattern: seed.user.N@restaurantguide.by
 */

import pg from 'pg';
import readline from 'readline';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

const SEED_USER_EMAIL_LIKE = 'seed.user.%@restaurantguide.by';

/**
 * Prompt user for confirmation
 */
function promptConfirmation(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   🗑️  Clear Seed Reviews & Users');
  console.log('═══════════════════════════════════════════════════════\n');

  let client;

  try {
    client = await pool.connect();
    console.log('✓ Database connection established\n');

    // Count seed users and their reviews
    const usersResult = await client.query(
      'SELECT id, name FROM users WHERE email LIKE $1',
      [SEED_USER_EMAIL_LIKE],
    );
    const userIds = usersResult.rows.map(r => r.id);

    if (userIds.length === 0) {
      console.log('ℹ️  No seed users found. Nothing to clear.\n');
      return;
    }

    const reviewsResult = await client.query(
      'SELECT COUNT(*) as count FROM reviews WHERE user_id = ANY($1)',
      [userIds],
    );
    const reviewCount = parseInt(reviewsResult.rows[0].count, 10);

    console.log(`📊 Found ${userIds.length} seed users with ${reviewCount} reviews\n`);

    // Confirm unless --force
    const forceMode = process.argv.includes('--force') || process.argv.includes('-f');
    if (!forceMode) {
      const confirmed = await promptConfirmation(
        `⚠️  This will DELETE ${reviewCount} reviews and ${userIds.length} seed users. Continue?`,
      );
      if (!confirmed) {
        console.log('\n❌ Operation cancelled.\n');
        return;
      }
    }

    await client.query('BEGIN');

    // Get affected establishments before deletion
    const affectedResult = await client.query(
      'SELECT DISTINCT establishment_id FROM reviews WHERE user_id = ANY($1)',
      [userIds],
    );
    const affectedEstablishmentIds = affectedResult.rows.map(r => r.establishment_id);

    // Delete reviews by seed users
    const deleteReviewsResult = await client.query(
      'DELETE FROM reviews WHERE user_id = ANY($1)',
      [userIds],
    );
    console.log(`\n🗑️  Deleted ${deleteReviewsResult.rowCount} reviews`);

    // Recalculate aggregates for affected establishments
    if (affectedEstablishmentIds.length > 0) {
      console.log(`📊 Recalculating aggregates for ${affectedEstablishmentIds.length} establishments...`);
      for (const id of affectedEstablishmentIds) {
        await client.query(
          `UPDATE establishments
           SET
             average_rating = COALESCE(
               (SELECT AVG(rating)::DECIMAL(3,2) FROM reviews WHERE establishment_id = $1 AND is_deleted = false),
               0.0
             ),
             review_count = (
               SELECT COUNT(*) FROM reviews WHERE establishment_id = $1 AND is_deleted = false
             ),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id],
        );
      }
      console.log('  ✓ Aggregates recalculated');
    }

    // Delete seed users (must be after reviews due to FK)
    const deleteUsersResult = await client.query(
      'DELETE FROM users WHERE email LIKE $1',
      [SEED_USER_EMAIL_LIKE],
    );
    console.log(`👥 Deleted ${deleteUsersResult.rowCount} seed users`);

    await client.query('COMMIT');

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`✅ Cleared ${deleteReviewsResult.rowCount} reviews and ${deleteUsersResult.rowCount} users`);
    console.log('═══════════════════════════════════════════════════════\n');
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('\n❌ Clear process failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
