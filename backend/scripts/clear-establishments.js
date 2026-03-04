/**
 * Clear Establishments Script
 *
 * Utility script to remove establishments from the database.
 * Useful for cleaning up test data or resetting the database state.
 *
 * Usage: npm run clear-data                    — delete ALL establishments (with confirmation)
 *        npm run clear-data -- --seed-only     — delete ONLY seed establishments
 *        npm run clear-data -- --force         — skip confirmation prompt
 *
 * --seed-only: Deletes only establishments owned by seed.data.generator@restaurantguide.by
 *              Safe to use when real partner data exists in the database.
 *
 * Safety: Prompts for confirmation before deleting unless --force flag used
 */

import pkg from 'pg';
import readline from 'readline';
import dotenv from 'dotenv';

const { Pool } = pkg;

// Load environment variables
dotenv.config();

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

/**
 * Prompt user for confirmation
 * Returns a promise that resolves to true if user confirms, false otherwise
 */
function promptConfirmation(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

const SEED_PARTNER_EMAIL = 'seed.data.generator@restaurantguide.by';

/**
 * Get establishment count (all or seed-only)
 */
async function getEstablishmentCount(seedOnly = false) {
  try {
    if (seedOnly) {
      const result = await pool.query(
        `SELECT COUNT(*) FROM establishments
         WHERE partner_id = (SELECT id FROM users WHERE email = $1)`,
        [SEED_PARTNER_EMAIL]
      );
      return parseInt(result.rows[0].count);
    }
    const result = await pool.query('SELECT COUNT(*) FROM establishments');
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('❌ Error getting count:', error.message);
    return 0;
  }
}

/**
 * Clear establishments from database
 * @param {boolean} seedOnly - if true, delete only seed partner's establishments
 */
async function clearEstablishments(seedOnly = false) {
  try {
    if (seedOnly) {
      const result = await pool.query(
        `DELETE FROM establishments
         WHERE partner_id = (SELECT id FROM users WHERE email = $1)`,
        [SEED_PARTNER_EMAIL]
      );
      return result.rowCount;
    }
    const result = await pool.query('DELETE FROM establishments');
    return result.rowCount;
  } catch (error) {
    console.error('❌ Error clearing establishments:', error.message);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  const seedOnly = process.argv.includes('--seed-only');
  const forceMode = process.argv.includes('--force') || process.argv.includes('-f');

  const modeLabel = seedOnly ? 'Seed-Only Cleanup' : 'Full Database Cleanup';

  console.log('═══════════════════════════════════════════════════════');
  console.log(`   🗑️  Clear Establishments - ${modeLabel}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (seedOnly) {
    console.log(`ℹ️  Mode: --seed-only (only ${SEED_PARTNER_EMAIL})\n`);
  }

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Get counts
    const targetCount = await getEstablishmentCount(seedOnly);
    const totalCount = seedOnly ? await getEstablishmentCount(false) : targetCount;

    if (seedOnly) {
      console.log(`📊 Total establishments in database: ${totalCount}`);
      console.log(`📊 Seed establishments to delete: ${targetCount}`);
      console.log(`📊 Partner establishments (safe): ${totalCount - targetCount}\n`);
    } else {
      console.log(`📊 Current establishments in database: ${totalCount}\n`);
    }

    if (targetCount === 0) {
      const msg = seedOnly
        ? 'No seed establishments found. Nothing to clear.'
        : 'Database is already empty. Nothing to clear.';
      console.log(`ℹ️  ${msg}`);
      await pool.end();
      return;
    }

    if (!forceMode) {
      const promptMsg = seedOnly
        ? `⚠️  This will DELETE ${targetCount} seed establishments (${totalCount - targetCount} partner establishments will be kept). Are you sure?`
        : `⚠️  This will DELETE all ${targetCount} establishments. Are you sure?`;

      const confirmed = await promptConfirmation(promptMsg);

      if (!confirmed) {
        console.log('\n❌ Operation cancelled by user.');
        await pool.end();
        return;
      }
    }

    console.log('\n🗑️  Clearing establishments...');

    // Perform deletion
    const deletedCount = await clearEstablishments(seedOnly);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`✅ Successfully deleted ${deletedCount} ${seedOnly ? 'seed ' : ''}establishments`);
    if (seedOnly) {
      const remaining = totalCount - deletedCount;
      console.log(`✅ ${remaining} partner establishment(s) preserved`);
    }
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}

export { clearEstablishments };

