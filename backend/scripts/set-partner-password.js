/**
 * Set (or reset) a partner account's login password on production.
 *
 * Purpose: the seed house account (seed.data.generator@restaurantguide.by) was
 * created without a password (script-provisioned owner of seed cards), so nobody
 * can log into the web cabinet as it. This grants it a login so a collector can
 * enter cards through the partner form under the house account (ownership stays
 * with the platform → claim-model intact).
 *
 * Security model (mirrors apply-migration-production.js):
 *   - Reads DATABASE_URL from backend/.env.production (gitignored, user-managed).
 *   - Reads the new password from the NEW_PASSWORD env var — NEVER an argument,
 *     so it does not land in shell history or `ps`. The password is never printed
 *     and never leaves this machine.
 *   - Hashes with the same Argon2id params the backend uses (argon2.verify reads
 *     the params from the hash, so the login will match regardless).
 *   - Requires typing "yes" to confirm (skip with --yes).
 *
 * Usage (PowerShell):
 *   $env:NEW_PASSWORD = "choose-a-strong-password"
 *   node scripts/set-partner-password.js --email=seed.data.generator@restaurantguide.by
 *   Remove-Item Env:\NEW_PASSWORD          # clear it from the session afterwards
 *
 * Usage (bash):
 *   NEW_PASSWORD='choose-a-strong-password' \
 *     node scripts/set-partner-password.js --email=seed.data.generator@restaurantguide.by
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';
import argon2 from 'argon2';
import dotenv from 'dotenv';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(resolve(__dirname, '..'), '.env.production');

if (!existsSync(envPath)) {
  console.error('❌ Missing backend/.env.production (needs DATABASE_URL). See scripts/README-MIGRATIONS.md');
  process.exit(1);
}
dotenv.config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set in .env.production'); process.exit(1); }

const args = process.argv.slice(2);
const skipConfirm = args.includes('--yes');
const emailArg = args.find((a) => a.startsWith('--email='));
const email = emailArg ? emailArg.slice('--email='.length) : 'seed.data.generator@restaurantguide.by';

const password = process.env.NEW_PASSWORD;
if (!password) {
  console.error('❌ Set the password via the NEW_PASSWORD env var (not an argument).');
  console.error('   PowerShell:  $env:NEW_PASSWORD = "..."; node scripts/set-partner-password.js --email=...');
  process.exit(1);
}
if (password.length < 8) { console.error('❌ Password must be at least 8 characters.'); process.exit(1); }

// Same Argon2id params as authService.js (verify reads params from the hash anyway).
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 16384, timeCost: 3, parallelism: 1 };

const hostDisplay = (() => { try { const u = new URL(DATABASE_URL); return `${u.hostname}:${u.port}${u.pathname}`; } catch { return '(unparseable)'; } })();

function confirm() {
  if (skipConfirm) return Promise.resolve(true);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question('Set this password? Type "yes" to confirm: ', (a) => { rl.close(); res(a.trim().toLowerCase() === 'yes'); }));
}

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();

  const before = await client.query(
    `SELECT id, email, role, is_active, auth_method, (password_hash IS NOT NULL) AS has_password
       FROM users WHERE email = $1`,
    [email],
  );
  if (!before.rows.length) { console.error(`❌ No user with email ${email}`); await client.end(); process.exit(1); }
  const u = before.rows[0];

  console.log('\n════════════════════════════════════════════════');
  console.log('  SET PARTNER PASSWORD — production');
  console.log('════════════════════════════════════════════════');
  console.log(`  Host:        ${hostDisplay}`);
  console.log(`  Target user: ${u.email}  (role=${u.role}, active=${u.is_active}, auth=${u.auth_method})`);
  console.log(`  Has password now: ${u.has_password}  →  will be: true`);
  console.log('════════════════════════════════════════════════\n');

  if (!(await confirm())) { console.log('Aborted — no changes made.'); await client.end(); process.exit(0); }

  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
  const upd = await client.query(
    `UPDATE users SET password_hash = $1, updated_at = $2
      WHERE email = $3 AND is_active = true
      RETURNING id, email`,
    [passwordHash, new Date(), email],
  );

  if (!upd.rows.length) console.error('❌ Update affected 0 rows (user inactive?).');
  else console.log(`✅ Password set for ${upd.rows[0].email}. You can now log into the partner cabinet as this account.`);

  await client.end();
}

run().catch(async (e) => { console.error('❌ Failed:', e.message); try { await client.end(); } catch {} process.exit(1); });
