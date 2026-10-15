/**
 * Switch an account on or off (users.is_active) — the way to revoke a
 * panel account (admin or viewer) once a demo or a collaboration is over.
 *
 * What deactivation does, by the backend's own checks:
 *   - login is refused at once (verifyCredentials filters is_active = true);
 *   - token refresh is refused at once (refreshAccessToken checks is_active);
 *   - an access token already issued stops working within
 *     ACCOUNT_STATUS_TTL_MS (10 s): since 2026-10-07 authenticate() asks the
 *     database whether the account is active (services/accountStatus.js,
 *     cached briefly per server process). Until then it checked the
 *     signature only and the token lived up to JWT_ACCESS_EXPIRY (4h).
 *
 * And what it ends, since 2026-10-15 (directive service_accounts, B4; critic
 * 2B B2): every session of the account, its push devices and its unused
 * password-reset links (lib/operator-password.js endAllSessions), in the same
 * transaction as the switch. Until then the switch wrote is_active only: the
 * sessions were refused while the account was off and came back to life when
 * it was switched on again — a revocation that could be undone by accident.
 * Switching ON ends them too: an account switched off before this rule may
 * still hold sessions from before, and switching it on must not revive them.
 * Whoever uses the account signs in again.
 *
 * Security model (mirrors set-partner-password.js):
 *   - Target database: with --production, DATABASE_URL from
 *     backend/.env.production (gitignored, user-managed; TLS to the pinned
 *     certificate only — scripts/lib/productionDb.js);
 *     without it, the DB_* variables of a local database.
 *   - Refuses to deactivate the last active admin: the panel must keep at
 *     least one account that can act.
 *   - Requires typing "yes" to confirm (skip with --yes).
 *
 * Usage:
 *   node scripts/set-user-active.js --email=guest@example.com --active=false --production
 *   node scripts/set-user-active.js --email=guest@example.com --active=true --production
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';
import dotenv from 'dotenv';
import { ProductionClient } from './lib/productionDb.js';
import { reportEndedSessions, writePasswordEndingSessions } from './lib/operator-password.js';

const { Client } = pg;

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const email = (option('email') || '').trim().toLowerCase();
const activeArg = option('active');
const production = hasFlag('production');
const skipConfirm = hasFlag('yes');

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/set-user-active.js --email=<email> --active=true|false [--production] [--yes]');
  process.exit(1);
};

if (!email || !email.includes('@')) usage('--email=<email> is required');
if (activeArg !== 'true' && activeArg !== 'false') usage('--active=true or --active=false is required');
const active = activeArg === 'true';

const buildClient = () => {
  if (production) {
    const envPath = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.env.production');
    if (!existsSync(envPath)) {
      console.error('❌ Missing backend/.env.production (needs DATABASE_URL). See scripts/README-MIGRATIONS.md');
      process.exit(1);
    }
    dotenv.config({ path: envPath });
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL not set in backend/.env.production');
      process.exit(1);
    }
    // Only the server whose certificate is pinned (scripts/lib/productionDb.js)
    return new ProductionClient({ connectionString: process.env.DATABASE_URL });
  }
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'restaurant_guide_belarus',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_dev_password',
  });
};

const confirm = () => new Promise((resolveAnswer) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Type "yes" to continue: ', (answer) => {
    rl.close();
    resolveAnswer(answer.trim().toLowerCase() === 'yes');
  });
});

const main = async () => {
  const client = buildClient();
  await client.connect();
  try {
    const found = await client.query(
      'SELECT id, email, name, role, is_active FROM users WHERE email = $1',
      [email],
    );
    const account = found.rows[0];
    if (!account) {
      console.error(`❌ No account with e-mail ${email}.`);
      return 1;
    }

    console.log(`Account: ${account.email} (${account.name}), role ${account.role}, active ${account.is_active}`);
    console.log(`Target: ${production
      ? 'PRODUCTION (DATABASE_URL from backend/.env.production)'
      : `local ${client.host}:${client.port}/${client.database}`}`);

    if (account.is_active === active) {
      console.log(`Nothing to do: the account is already ${active ? 'active' : 'inactive'}.`);
      return 0;
    }

    if (!active && account.role === 'admin') {
      const admins = await client.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = true",
      );
      if (admins.rows[0].count <= 1) {
        console.error('❌ Refusing: this is the last active admin. Create another admin first (create-admin.js).');
        return 1;
      }
    }

    console.log(`Will set is_active = ${active} for ${account.email}; every session, push device and unused reset link of the account ends.`);
    if (!active) {
      console.log('   Login and token refresh stop immediately; an access token already issued stops working within 10 seconds.');
    }

    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted.');
      return 1;
    }

    // The switch and the revocation in one transaction (the write helper of
    // the password scripts: it ends the sessions of the row the write returns).
    const { account: updated, sessions } = await writePasswordEndingSessions(client, async (tx) => (await tx.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, role, is_active`,
      [active, account.id],
    )).rows[0]);
    console.log(`✅ ${updated.email} (${updated.role}) is now ${updated.is_active ? 'active' : 'inactive'}.`);
    reportEndedSessions(sessions);
    return 0;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
