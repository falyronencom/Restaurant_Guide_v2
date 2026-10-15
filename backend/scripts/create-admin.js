/**
 * Create (or reset) an `admin` account of the admin panel — the one door to
 * the panel's acting role.
 *
 * Until 2026-10-15 this script had none of the guards of create-viewer.js:
 * no production flag and no pinned certificate, no target shown, no "yes",
 * an address by default at a domain the project does not own (the panel's
 * production admin stood on it), and an existing account of ANY role with
 * the given address was silently made an admin (directive service_accounts,
 * B5; cloud critic 2B S1). Now:
 *   - --email is required; no default;
 *   - target database: with --production, DATABASE_URL from the environment
 *     or backend/.env.production, over TLS to the pinned certificate only
 *     (scripts/lib/productionDb.js); without it, the DB_* variables of a
 *     local database. The target is shown; type "yes" (skip with --yes);
 *   - the password comes from the ADMIN_PASSWORD env var — never an argument
 *     — at least 8 characters, never printed;
 *   - an existing admin is reset: new password, name, active; every session,
 *     push device and unused reset link of the account ends
 *     (lib/operator-password.js);
 *   - an existing account of another role is refused — unless --promote is
 *     given, and then its current role is shown before the "yes". Promotion
 *     ends every session too: a session opened through another door never
 *     carries on as a panel session;
 *   - the address is shown with its verdict — on our mailbox or not
 *     (lib/serviceAccounts.js); a panel account on a stranger's domain gets
 *     its password resets delivered to the stranger;
 *   - the journal records the creation, reset or promotion
 *     (operator_create_admin / operator_reset_admin / operator_promote_admin),
 *     the address under user_email — withheld from the viewer role; a
 *     Google/Yandex link of the account is dropped.
 *
 * Usage (PowerShell, from backend/):
 *   $env:ADMIN_PASSWORD = "choose-a-strong-password"
 *   node scripts/create-admin.js --email=<address> [--name="<name>"] [--promote] [--production] [--yes]
 *   Remove-Item Env:\ADMIN_PASSWORD
 *   From a git worktree: node --env-file=<main checkout>/backend/.env.production scripts/create-admin.js … --production
 */
import { createInterface } from 'readline';
import argon2 from 'argon2';
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import { reportEndedSessions, writePasswordEndingSessions } from './lib/operator-password.js';
import { displayAddress, isOurAddress, loginFormOf, mailboxesFrom } from './lib/serviceAccounts.js';

const { Client } = pg;

// Same Argon2id parameters the backend uses; argon2.verify reads them from
// the hash, so the login matches regardless.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384,
  timeCost: 3,
  parallelism: 1,
};

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const emailArg = (option('email') || '').trim();
const name = (option('name') || 'Admin').trim();
const production = hasFlag('production');
const skipConfirm = hasFlag('yes');
const promote = hasFlag('promote');
const password = process.env.ADMIN_PASSWORD;

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   ADMIN_PASSWORD=... node scripts/create-admin.js --email=<email> [--name="<name>"] [--promote] [--production] [--yes]');
  process.exit(1);
};

if (!emailArg) usage('--email=<email> is required (there is no default address)');
if (!password) usage('Set the password via the ADMIN_PASSWORD env var (not an argument)');
if (password.length < 8) usage('Password must be at least 8 characters');

const buildClient = () => {
  if (production) {
    return new ProductionClient({ connectionString: loadProductionEnvironment() });
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

const journal = (db, action, accountId, data) => db.query(
  `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
   VALUES (NULL, $1, 'user', $2, $3, $4, NULL, 'operator_script:create-admin')`,
  [action, accountId, JSON.stringify(data.old), JSON.stringify({ ...data.new, actor: 'operator_script:create-admin' })],
);

const main = async () => {
  let client;
  let mailboxes;
  try {
    client = buildClient();
    mailboxes = await mailboxesFrom(process.env);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
  // The address in the form the panel login looks it up by.
  const email = await loginFormOf(emailArg);
  if (!email) {
    console.error('❌ --email is not an address the login accepts.');
    return 1;
  }
  try {
    await client.connect();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
  try {
    const existing = await client.query(
      'SELECT id, role, is_active FROM users WHERE lower(email) = $1',
      [email],
    );
    const row = existing.rows[0];
    const shown = displayAddress(email, mailboxes);

    if (row && row.role !== 'admin' && !promote) {
      console.error(`❌ ${shown} already exists with role '${row.role}'.`);
      console.error('   This script does not change the role of an existing account unless --promote is given.');
      return 1;
    }

    console.log(row
      ? `Will ${row.role === 'admin' ? 'RESET the admin account' : `PROMOTE the '${row.role}' account to admin:`} ${shown}: new password, name "${name}", active; every session of the account ends.`
      : `Will CREATE the admin account ${shown} (name "${name}").`);
    console.log(`Address: ${isOurAddress(email, mailboxes) ? 'on our mailbox' : 'NOT on our mailbox — password resets for it reach whoever owns that domain'}`);
    console.log(`Target: ${production
      ? `PRODUCTION (${client.host}:${client.port}/${client.database})`
      : `local ${client.host}:${client.port}/${client.database}`}`);

    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted.');
      return 1;
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    let account;
    let sessions = null;
    if (row) {
      ({ account, sessions } = await writePasswordEndingSessions(client, async (tx) => {
        // A panel account signs in by password only: a Google/Yandex link the
        // account had before is dropped, so none lies dormant should the role
        // ever be taken away by hand (Phase 3.5, lens).
        const updated = (await tx.query(
          `UPDATE users
           SET password_hash = $1, name = $2, role = 'admin', is_active = true,
               oauth_provider_id = NULL,
               auth_method = CASE WHEN auth_method IN ('google', 'yandex') THEN 'email' ELSE auth_method END,
               updated_at = NOW()
           WHERE id = $3
           RETURNING id, email, role, name, is_active`,
          [passwordHash, name, row.id],
        )).rows[0];
        await journal(tx, row.role === 'admin' ? 'operator_reset_admin' : 'operator_promote_admin', row.id, {
          old: { role: row.role, is_active: row.is_active },
          new: { user_email: updated.email, role: 'admin', is_active: true },
        });
        return updated;
      }));
    } else {
      await client.query('BEGIN');
      try {
        account = (await client.query(
          `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, is_active, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'admin', 'email', true, true, NOW(), NOW())
           RETURNING id, email, role, name, is_active`,
          [email, passwordHash, name],
        )).rows[0];
        await journal(client, 'operator_create_admin', account.id, {
          old: null,
          new: { user_email: account.email, role: 'admin' },
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`✅ Admin ${row ? 'updated' : 'created'}: ${displayAddress(account.email, mailboxes)} (${account.name}), role ${account.role}, active ${account.is_active}`);
    console.log('   Password: the one in ADMIN_PASSWORD (not printed)');
    if (sessions) reportEndedSessions(sessions);
    console.log('   Sign in at the admin panel with this e-mail and the password you set.');
    return 0;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
