/**
 * Production Migration Runner
 *
 * Applies a migration SQL file to the production database configured via
 * DATABASE_URL in backend/.env.production (gitignored — user-managed).
 *
 * Designed so credentials never leave the local machine: no need to paste
 * the Railway password into any external tool or chat. The .env.production
 * file is created once (see scripts/README-MIGRATIONS.md) and reused.
 *
 * Safety features:
 *   - Reads host/DB for display, hides password
 *   - Prints first 40 lines of SQL for eyeball review
 *   - Requires typing "yes" to confirm (skip with --yes for CI)
 *   - SSL enforced (Railway requirement)
 *
 * Usage:
 *   node scripts/apply-migration-production.js <migration-name>
 *   node scripts/apply-migration-production.js 023_add_file_type_to_media
 *   node scripts/apply-migration-production.js 023_add_file_type_to_media --yes
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import { createInterface } from 'readline';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;

// Resolve project paths relative to this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = resolve(__dirname, '..');
const migrationsDir = join(backendRoot, 'migrations');
const envPath = join(backendRoot, '.env.production');

// ──────────────────────────────────────────────────────────
// 1. Validate environment
// ──────────────────────────────────────────────────────────
if (!existsSync(envPath)) {
  console.error('❌ Missing backend/.env.production');
  console.error('');
  console.error('   Create it once with your Railway DATABASE_URL:');
  console.error('   DATABASE_URL=postgresql://postgres:<password>@turntable.proxy.rlwy.net:<port>/railway');
  console.error('');
  console.error('   See scripts/README-MIGRATIONS.md for setup steps.');
  process.exit(1);
}
dotenv.config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in backend/.env.production');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────
// 2. Parse arguments
// ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const skipConfirm = args.includes('--yes');
const migrationName = args.find((a) => !a.startsWith('--'));

if (!migrationName) {
  console.error('Usage: node scripts/apply-migration-production.js <migration-name> [--yes]');
  console.error('Example: node scripts/apply-migration-production.js 023_add_file_type_to_media');
  process.exit(1);
}

const migrationFile = join(migrationsDir, `${migrationName}.sql`);
if (!existsSync(migrationFile)) {
  console.error(`❌ Migration file not found: ${migrationFile}`);
  console.error('   (Name should be without .sql extension)');
  process.exit(1);
}

const sql = readFileSync(migrationFile, 'utf8');
const sqlLines = sql.split('\n');

// ──────────────────────────────────────────────────────────
// 3. Parse URL for display (hides password)
// ──────────────────────────────────────────────────────────
let hostDisplay;
let userDisplay;
try {
  const urlObj = new URL(DATABASE_URL);
  hostDisplay = `${urlObj.hostname}:${urlObj.port}${urlObj.pathname}`;
  userDisplay = urlObj.username;
} catch {
  console.error('❌ DATABASE_URL is not a valid URL');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────
// 4. Display summary
// ──────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  PRODUCTION MIGRATION — review before confirming');
console.log('════════════════════════════════════════════════════════');
console.log(`  Host:     ${hostDisplay}`);
console.log(`  User:     ${userDisplay}`);
console.log(`  File:     ${basename(migrationFile)}`);
console.log(`  Lines:    ${sqlLines.length}`);
console.log('════════════════════════════════════════════════════════');
console.log('');
console.log(`--- SQL preview (first ${Math.min(40, sqlLines.length)} lines) ---`);
console.log(sqlLines.slice(0, 40).join('\n'));
if (sqlLines.length > 40) {
  console.log(`... (${sqlLines.length - 40} more lines)`);
}
console.log('---');
console.log('');

// ──────────────────────────────────────────────────────────
// 5. Confirm
// ──────────────────────────────────────────────────────────
function confirm() {
  if (skipConfirm) return Promise.resolve(true);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question('Apply this migration? Type "yes" to confirm: ', (answer) => {
      rl.close();
      res(answer.trim().toLowerCase() === 'yes');
    });
  });
}

// ──────────────────────────────────────────────────────────
// 6. Execute
// ──────────────────────────────────────────────────────────
async function run() {
  const ok = await confirm();
  if (!ok) {
    console.log('Aborted — no changes made.');
    process.exit(0);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Railway requires SSL
  });

  try {
    await client.connect();
    console.log('✓ Connected to production DB');
    console.log('→ Applying migration...');
    await client.query(sql);
    console.log('');
    console.log('✅ Migration applied successfully.');
  } catch (err) {
    console.error('');
    console.error('❌ Migration failed:', err.message);
    if (err.position) {
      console.error(`   (Error position in SQL: ${err.position})`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
