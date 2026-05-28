/**
 * Production Migration Check (READ-ONLY)
 *
 * Inspects production database schema and reports which migrations
 * appear applied, based on schema markers (tables, columns, constraints,
 * indexes). This project has no schema_migrations tracking table, so
 * the schema state itself is the source of truth.
 *
 * Read-only by design: every query targets information_schema /
 * pg_catalog. No data is modified.
 *
 * Usage:
 *   node scripts/check-production-migrations.js
 *
 * Requires backend/.env.production with DATABASE_URL (Railway).
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = resolve(__dirname, '..');
const envPath = join(backendRoot, '.env.production');

if (!existsSync(envPath)) {
  console.error('Missing backend/.env.production');
  process.exit(1);
}
dotenv.config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in backend/.env.production');
  process.exit(1);
}

// Marker queries. Each returns true if the migration appears applied.
// Markers chosen to be specific, idempotent, and unambiguous.
const MARKERS = [
  {
    id: '022',
    label: 'push notifications (device_tokens table)',
    query: `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'device_tokens'`,
  },
  {
    id: '023',
    label: 'establishment_media.file_type column',
    query: `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'establishment_media'
              AND column_name = 'file_type'`,
  },
  {
    id: '024',
    label: 'OCR menu pipeline (ocr_jobs table)',
    query: `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'ocr_jobs'`,
  },
  {
    id: '025',
    label: 'menu_items.hidden_reason column',
    query: `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'menu_items'
              AND column_name = 'hidden_reason'`,
  },
  {
    id: '026',
    label: 'email_verification_codes table',
    query: `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'email_verification_codes'`,
  },
  {
    id: '027a',
    label: 'establishments.slug column',
    query: `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'establishments'
              AND column_name = 'slug'`,
  },
  {
    id: '027b',
    label: 'establishments_slug_unique constraint',
    query: `SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'establishments'
              AND constraint_name = 'establishments_slug_unique'`,
  },
  {
    id: '028',
    label: 'redundant idx_establishments_slug DROPPED',
    // Inverted check: marker is "applied" if the index is ABSENT.
    query: `SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'idx_establishments_slug'`,
    invert: true,
  },
];

function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}:***@${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

async function main() {
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  PRODUCTION MIGRATION CHECK (read-only)');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Target: ${maskUrl(DATABASE_URL)}`);
  console.log('────────────────────────────────────────────────────────');

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected. Running marker checks...');
    console.log('');

    const results = [];
    for (const m of MARKERS) {
      const res = await client.query(m.query);
      const found = res.rowCount > 0;
      const applied = m.invert ? !found : found;
      results.push({ ...m, applied });
      const mark = applied ? '✅' : '❌';
      console.log(`  ${mark}  Migration ${m.id.padEnd(5)}  ${m.label}`);
    }

    console.log('');
    console.log('────────────────────────────────────────────────────────');

    const lastApplied = [...results].reverse().find((r) => r.applied);
    const firstMissing = results.find((r) => !r.applied);

    if (!firstMissing) {
      console.log(`  Production is at the latest checked migration: ${lastApplied.id}`);
    } else if (!lastApplied) {
      console.log('  None of the checked migrations are present. Production');
      console.log('  is older than migration 022 — check earlier markers.');
    } else {
      console.log(`  Highest applied: ${lastApplied.id}`);
      console.log(`  First missing:   ${firstMissing.id} (${firstMissing.label})`);
    }
    console.log('════════════════════════════════════════════════════════');
    console.log('');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('');
  console.error('Check failed:', err.message);
  process.exit(1);
});
