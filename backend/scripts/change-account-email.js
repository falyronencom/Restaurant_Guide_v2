/**
 * Move an account to another address of ours — the service accounts' way off
 * domains the project does not own (directive service_accounts 2026-10-15,
 * A2). What the move writes and ends: scripts/lib/accountEmail.js.
 *
 * Dry run by default: it shows the target database, the account (role,
 * cards owned, sign-in method), the old and the new address — the new one in
 * the form the login will look it up by — and how many sessions, devices,
 * reset links and codes the move would end. Nothing is written.
 *
 * To write, name the address the account stands on now, exactly:
 * --confirm-old=<current address>; then type "yes" (skip with --yes). A
 * confirmation that does not match is refused — the operator writes what
 * they have just read, not what they remember.
 *
 * Only to an address of ours: a domain the project owns, or the operator's
 * mailbox from SERVICE_ACCOUNT_MAILBOXES (backend/.env.production — never in
 * the repository), or its tagged form on Gmail. A mistake is corrected by
 * moving again to another address of ours; never back to a stranger's domain.
 * The operator's mailbox is never printed — a label stands for it.
 *
 * After the move the account has no session anywhere; sign in with the new
 * address and the old password, or set a password with set-partner-password.js
 * / create-viewer.js. A server process may let an access token issued before
 * the move through for up to 10 seconds (its cached account status).
 *
 * Target: with --production, DATABASE_URL from the environment or
 * backend/.env.production, over TLS to the pinned certificate only
 * (scripts/lib/productionDb.js); without it, the DB_* variables of a local
 * database.
 *
 * Usage (from backend/):
 *   node scripts/change-account-email.js --email=<current> --new-email=<new> [--production]
 *   node scripts/change-account-email.js --email=<current> --new-email=<new> --confirm-old=<current> [--production] [--yes]
 *   From a git worktree: node --env-file=<main checkout>/backend/.env.production scripts/change-account-email.js … --production
 */
import { createInterface } from 'readline';
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import { applyEmailChange, planEmailChange } from './lib/accountEmail.js';
import { displayAddress, mailboxesFrom } from './lib/serviceAccounts.js';
import { ACCOUNT_STATUS_TTL_SECONDS, reportEndedSessions } from './lib/operator-password.js';

const { Client } = pg;

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const currentEmail = (option('email') || '').trim().toLowerCase();
const newEmail = (option('new-email') || '').trim();
const confirmOld = option('confirm-old');
const production = hasFlag('production');
const skipConfirm = hasFlag('yes');

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/change-account-email.js --email=<current> --new-email=<new> [--confirm-old=<current>] [--production] [--yes]');
  process.exit(1);
};

if (!currentEmail || !currentEmail.includes('@')) usage('--email=<current address> is required');
if (!newEmail) usage('--new-email=<new address> is required');

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
    const plan = await planEmailChange(client, { currentEmail, newEmail, mailboxes });
    const a = plan.account;
    const writing = confirmOld !== null;

    console.log('════════════════════════════════════════════════');
    console.log(`  CHANGE ACCOUNT E-MAIL — ${writing ? 'WRITE' : 'dry run (nothing is written)'}`);
    console.log('════════════════════════════════════════════════');
    console.log(`  Target:   ${production
      ? `PRODUCTION (${client.host}:${client.port}/${client.database})`
      : `local ${client.host}:${client.port}/${client.database}`}`);
    console.log(`  Account:  id ${a.id}, role ${a.role}, active ${a.is_active}, cards owned ${a.cards}`);
    console.log(`  Sign-in:  ${a.auth_method}; password set: ${a.has_password}; Google/Yandex linked: ${a.provider_linked}`);
    console.log(`  Address:  ${displayAddress(plan.from, mailboxes)}  →  ${displayAddress(plan.to, mailboxes)}`);
    console.log('            (the new address as the login looks it up)');
    console.log(`  Ends:     ${a.refresh_tokens} session(s), ${a.devices} push device(s), ${a.reset_links} reset link(s), ${a.email_codes} e-mail code(s)` +
      `${a.provider_linked ? ', the Google/Yandex link' : ''}`);
    console.log('  Journal:  change_email, old and new address (hidden from the viewer role)');
    console.log('════════════════════════════════════════════════');

    if (!writing) {
      console.log('Dry run. To write, add --confirm-old=<the current address, exactly as shown above>.');
      return 0;
    }
    if (confirmOld.trim().toLowerCase() !== plan.from.toLowerCase()) {
      console.error('❌ --confirm-old does not match the address the account stands on now. Nothing was written.');
      return 1;
    }
    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted — nothing was written.');
      return 1;
    }

    const { account, ended, emailCodes } = await applyEmailChange(client, plan);
    console.log(`✅ Moved: account ${account.id} (${account.role}) now stands on ${displayAddress(account.email, mailboxes)}; sign-in ${account.auth_method}.`);
    reportEndedSessions(ended);
    console.log(`   E-mail codes spent: ${emailCodes}.`);
    console.log(`   A server process may let an old access token through for up to ${ACCOUNT_STATUS_TTL_SECONDS} seconds.`);
    return 0;
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
