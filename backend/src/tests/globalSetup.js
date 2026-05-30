/* eslint-disable no-console */
/**
 * Jest globalSetup — runs ONCE before the entire suite.
 *
 * Why a dedicated file with its own connection: globalSetup executes in a
 * separate Node context where setupFiles (setup-env.js) has NOT run, so the
 * app's shared pool (config/database.js) would load .env and bind to the dev
 * database. We therefore load .env.test explicitly and open our own short-lived
 * pool, guarded on a "test"-named database.
 *
 * Purpose: establish one clean baseline so the first test file (which may not
 * self-clean) never inherits remnants of a previously interrupted run — the
 * root of the historical isolation cascade (F1).
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TEST_STATE_TABLES } from './testTables.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function globalSetup() {
  console.log('\n🚀 Setting up test environment...\n');

  // Load test env in this isolated context (setup-env.js has not run here).
  dotenv.config({ path: join(__dirname, '../../.env.test') });

  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Tests must run in NODE_ENV=test environment!');
  }
  if (!process.env.DB_NAME || !process.env.DB_NAME.includes('test')) {
    throw new Error(
      `Test database name must contain "test"! Current: ${process.env.DB_NAME}`,
    );
  }

  // Own short-lived pool — must NOT reuse the app pool (would bind to dev env).
  const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: 1,
  });

  try {
    await pool.query('SELECT 1');
    console.log('✅ Database:', process.env.DB_NAME);

    // One clean global baseline (FK triggers off + CASCADE → order-independent).
    await pool.query('SET session_replication_role = replica;');
    for (const table of TEST_STATE_TABLES) {
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
    await pool.query('SET session_replication_role = DEFAULT;');
    console.log(`✅ Global baseline cleared (${TEST_STATE_TABLES.length} tables)`);
  } finally {
    await pool.end();
  }

  console.log('\n✅ Test environment ready!\n');
}
