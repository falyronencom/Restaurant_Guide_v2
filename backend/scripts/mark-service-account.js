/**
 * Mark the seed house — the partner account that owns the platform's cards —
 * as a service account (users.is_service_account, migration 037).
 *
 * Why: the seed scripts used to find the house by its address, at a domain
 * the project does not own, and created it when they did not find it. Since
 * 2026-10-15 they find it by this flag only and stop without it
 * (lib/seedHouse.js); the server restores its access only through the
 * operator's scripts — no «forgot password», no Google/Yandex
 * (src/config/serviceAccounts.js; directive service_accounts, B2/B3).
 *
 * What it refuses — each is a step the operator takes first:
 *   - an account that is not a partner: the flag is for the seed house;
 *   - an address that is not ours: move it first (change-account-email.js);
 *   - an account with a Google/Yandex link: the move drops it;
 *   - a second service partner: the seed scripts need exactly one.
 *
 * Dry run by default; to write: --confirm-old=<the account's address> and
 * "yes" (or --yes). Writes the journal (mark_service_account). Ends nothing:
 * the flag changes how access is restored, not who holds a session now.
 *
 * Usage (from backend/):
 *   node scripts/mark-service-account.js --email=<address> [--production]
 *   node scripts/mark-service-account.js --email=<address> --confirm-old=<address> [--production] [--yes]
 *   From a git worktree: node --env-file=<main checkout>/backend/.env.production scripts/mark-service-account.js … --production
 */
import { createInterface } from 'readline';
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import { displayAddress, isOurAddress, mailboxesFrom } from './lib/serviceAccounts.js';
import { SEED_HOUSE_SQL } from './lib/seedHouse.js';

const { Client } = pg;

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const email = (option('email') || '').trim().toLowerCase();
const confirmOld = option('confirm-old');
const production = hasFlag('production');
const skipConfirm = hasFlag('yes');

if (!email || !email.includes('@')) {
  console.error('❌ --email=<address> is required');
  console.error('   node scripts/mark-service-account.js --email=<address> [--confirm-old=<address>] [--production] [--yes]');
  process.exit(1);
}

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
  try {
    await client.connect();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
  try {
    const column = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_service_account'`,
    );
    if (column.rows.length === 0) {
      console.error('❌ Migration 037 is not applied on this database (no users.is_service_account).');
      console.error('   node scripts/apply-migration-production.js 037_service_account_flag');
      return 1;
    }

    const found = await client.query(
      `SELECT u.id, u.email, u.role, u.is_active, u.is_service_account,
              (u.oauth_provider_id IS NOT NULL) AS provider_linked,
              (SELECT COUNT(*)::int FROM establishments e WHERE e.partner_id = u.id) AS cards
       FROM users u WHERE lower(u.email) = $1`,
      [email],
    );
    const account = found.rows[0];
    const shown = displayAddress(email, mailboxes);
    if (!account) {
      console.error(`❌ No account stands on ${shown}.`);
      return 1;
    }

    console.log('════════════════════════════════════════════════');
    console.log(`  MARK SERVICE ACCOUNT — ${confirmOld !== null ? 'WRITE' : 'dry run (nothing is written)'}`);
    console.log('════════════════════════════════════════════════');
    console.log(`  Target:  ${production
      ? `PRODUCTION (${client.host}:${client.port}/${client.database})`
      : `local ${client.host}:${client.port}/${client.database}`}`);
    console.log(`  Account: ${shown}, id ${account.id}, role ${account.role}, active ${account.is_active}, cards owned ${account.cards}`);
    console.log('════════════════════════════════════════════════');

    if (account.is_service_account) {
      console.log('Nothing to do: the account is already a service account.');
      return 0;
    }
    if (account.role !== 'partner') {
      console.error(`❌ Refusing: the account is '${account.role}', the flag is for the seed house (a partner).`);
      return 1;
    }
    if (!isOurAddress(account.email, mailboxes)) {
      console.error('❌ Refusing: the account is not on an address of ours. Move it first: scripts/change-account-email.js');
      return 1;
    }
    if (account.provider_linked) {
      console.error('❌ Refusing: the account has a Google/Yandex link. Move it with scripts/change-account-email.js — the move drops the link.');
      return 1;
    }
    const others = (await client.query(SEED_HOUSE_SQL)).rows.filter((row) => row.id !== account.id);
    if (others.length > 0) {
      console.error(`❌ Refusing: there is already a service partner (${displayAddress(others[0].email, mailboxes)}). The seed scripts need exactly one.`);
      return 1;
    }

    if (confirmOld === null) {
      console.log('Dry run. To write, add --confirm-old=<the address shown above, exactly>.');
      return 0;
    }
    if (confirmOld.trim().toLowerCase() !== account.email.toLowerCase()) {
      console.error('❌ --confirm-old does not match the account\'s address. Nothing was written.');
      return 1;
    }
    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted — nothing was written.');
      return 1;
    }

    await client.query('BEGIN');
    try {
      await client.query(
        'UPDATE users SET is_service_account = true, updated_at = NOW() WHERE id = $1',
        [account.id],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent)
         VALUES (NULL, 'mark_service_account', 'user', $1, $2, $3, NULL, $4)`,
        [
          account.id,
          JSON.stringify({ is_service_account: false }),
          JSON.stringify({ is_service_account: true, actor: 'operator_script:mark-service-account' }),
          'operator_script:mark-service-account',
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(`✅ ${shown} is now the service account (seed house). The seed scripts find it by this flag.`);
    return 0;
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
