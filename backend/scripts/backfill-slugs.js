/**
 * Slug Backfill Script — Migration 027 Phase B
 *
 * Populates slug column for all existing establishments using slugGenerator.
 * Part 2 of 3 in the 027 workflow:
 *
 *   1. node scripts/run-migration.js migrations/027a_add_slug_column.sql
 *   2. node scripts/backfill-slugs.js   ← this script
 *   3. node scripts/run-migration.js migrations/027b_add_slug_constraints.sql
 *
 * Idempotent: only processes rows WHERE slug IS NULL. Safe to re-run after
 * interruption.
 *
 * Within-transaction collision handling: each generated slug is committed
 * row-by-row (within one outer transaction), and checkDuplicate sees those
 * uncommitted writes via PostgreSQL's READ COMMITTED isolation default —
 * so collisions inside the batch resolve correctly via auto-suffix.
 *
 * Usage (local DB — reads .env):
 *   node scripts/backfill-slugs.js
 *
 * Usage (production — reads .env.production via DATABASE_URL):
 *   DATABASE_URL_FILE=.env.production node scripts/backfill-slugs.js
 *   or set DATABASE_URL directly in the environment
 *
 * Environment (local mode):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD from .env
 *
 * Environment (production mode):
 *   DATABASE_URL — full postgres connection URL. SSL is enforced for Railway.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { generateUniqueSlug } from '../src/utils/slugGenerator.js';

// Production mode: load DATABASE_URL from explicit .env file if requested.
// Falls back to the normal .env-driven local mode otherwise.
const envFile = process.env.DATABASE_URL_FILE;
if (envFile && existsSync(envFile)) {
  dotenv.config({ path: envFile });
} else {
  dotenv.config();
}

const { Pool } = pg;

const usingDatabaseUrl = !!process.env.DATABASE_URL;
const pool = usingDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Railway requires SSL
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'restaurant_guide_belarus',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
    });

async function backfillSlugs() {
  let client;

  try {
    client = await pool.connect();

    console.log('🌱 Slug Backfill — Migration 027 Phase B');

    // Display target DB for operator eyeball check (matches apply-migration-production.js pattern)
    if (usingDatabaseUrl) {
      try {
        const u = new URL(process.env.DATABASE_URL);
        console.log(`   Target: ${u.hostname}:${u.port}${u.pathname} (production mode, SSL)`);
      } catch {
        console.log('   Target: (DATABASE_URL set but unparseable — proceeding)');
      }
    } else {
      console.log(`   Target: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'restaurant_guide_belarus'} (local mode)`);
    }
    console.log('');

    // Verify column exists before proceeding
    const columnCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'establishments' AND column_name = 'slug'
    `);

    if (columnCheck.rows.length === 0) {
      console.error('❌ Column "slug" does not exist on establishments table.');
      console.error('   Apply 027a_add_slug_column.sql first.');
      process.exit(1);
    }

    // Count rows needing backfill
    const nullCount = await client.query(
      'SELECT COUNT(*) AS count FROM establishments WHERE slug IS NULL',
    );
    const total = parseInt(nullCount.rows[0].count, 10);

    if (total === 0) {
      console.log('✓ No rows with NULL slug — nothing to backfill.');
      console.log('  (If this is unexpected, check whether 027b has already run.)');
      return;
    }

    console.log(`Found ${total} establishments without slug. Generating...\n`);

    // Fetch rows in creation order — gives deterministic suffix assignment
    // (older establishments get the base slug, newer ones get -2, -3, ...)
    const result = await client.query(
      'SELECT id, name FROM establishments WHERE slug IS NULL ORDER BY created_at ASC',
    );

    // checkDuplicate uses the live client connection. Within the transaction,
    // SELECTs see UPDATEs made earlier in the same transaction (READ COMMITTED),
    // so newly-assigned slugs become "taken" for subsequent rows in this batch.
    const checkDuplicate = async (slug) => {
      const dup = await client.query(
        'SELECT 1 FROM establishments WHERE slug = $1 LIMIT 1',
        [slug],
      );
      return dup.rows.length > 0;
    };

    await client.query('BEGIN');

    let successCount = 0;
    const failures = [];

    for (const row of result.rows) {
      try {
        const slug = await generateUniqueSlug(row.name, checkDuplicate);
        await client.query(
          'UPDATE establishments SET slug = $1 WHERE id = $2',
          [slug, row.id],
        );
        console.log(`  ✓ ${row.name} → ${slug}`);
        successCount++;
      } catch (err) {
        console.error(`  ✗ Failed for "${row.name}" (id: ${row.id}): ${err.message}`);
        failures.push({ id: row.id, name: row.name, error: err.message });
      }
    }

    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} failures — rolling back transaction.`);
      console.error('Failed rows:');
      failures.forEach((f) => console.error(`  - ${f.name} (${f.id}): ${f.error}`));
      await client.query('ROLLBACK');
      process.exit(1);
    }

    await client.query('COMMIT');

    console.log(`\n✅ Backfill complete: ${successCount} slugs generated\n`);
    console.log('Next step:');
    console.log('  node scripts/run-migration.js migrations/027b_add_slug_constraints.sql\n');
  } catch (error) {
    console.error('\n❌ Backfill failed:', error.message);
    console.error(error.stack);
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

backfillSlugs();
