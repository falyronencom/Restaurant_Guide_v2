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
 * Only to an address of ours: a mailbox the operator listed in
 * SERVICE_ACCOUNT_MAILBOXES (backend/.env.production — never in the
 * repository), or its tagged form on Gmail. A mistake is corrected by moving
 * again to another address of ours; never back to a stranger's domain. The
 * operator's mailbox is never printed — a label stands for it.
 *
 * Only a service account — a panel account, the flagged seed house, an
 * account on a domain the scripts have used, or one already on our mailbox —
 * unless --any-account is given: moving a person's account locks them out of
 * their own address.
 *
 * After the move the account has no password, no phone, no session anywhere.
 * Set a new password right away (set-partner-password.js --email=<new>, or
 * create-viewer.js / create-admin.js for a panel account); whoever knew the
 * old one — the owner of the old domain could have set it through a reset
 * link — no longer gets in. A few seconds after the commit a second pass ends
 * whatever a request that found the account by its old address just before
 * the move wrote just after it. A server process may let an access token
 * issued before the move through for up to 10 seconds (its cached status).
 *
 * Target: with --production, DATABASE_URL from the environment or
 * backend/.env.production, over TLS to the pinned certificate only
 * (scripts/lib/productionDb.js); without it, the DB_* variables of a local
 * database.
 *
 * Usage (from backend/):
 *   node scripts/change-account-email.js --email=<current> --new-email=<new> [--production]
 *   node scripts/change-account-email.js --email=<current> --new-email=<new> --confirm-old=<current> [--production] [--yes]
 *   --any-account: also a person's account (see above)
 *   From a git worktree: node --env-file=<main checkout>/backend/.env.production scripts/change-account-email.js … --production
 */
import { createInterface } from 'readline';
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import { SECOND_PASS_DELAY_MS, applyEmailChange, planEmailChange, secondPass } from './lib/accountEmail.js';
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
const allowAnyAccount = hasFlag('any-account');

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
    const plan = await planEmailChange(client, { currentEmail, newEmail, mailboxes, allowAnyAccount });
    const a = plan.account;
    const writing = confirmOld !== null;

    console.log('════════════════════════════════════════════════');
    console.log(`  CHANGE ACCOUNT E-MAIL — ${writing ? 'WRITE' : 'dry run (nothing is written)'}`);
    console.log('════════════════════════════════════════════════');
    console.log(`  Target:   ${production
      ? `PRODUCTION (${client.host}:${client.port}/${client.database})`
      : `local ${client.host}:${client.port}/${client.database}`}`);
    console.log(`  Account:  id ${a.id}, role ${a.role}, active ${a.is_active}, cards owned ${a.cards} — ${plan.reason}`);
    console.log(`  Sign-in:  ${a.auth_method}; password set: ${a.has_password}; Google/Yandex linked: ${a.provider_linked}`);
    console.log(`  Address:  ${displayAddress(plan.from, mailboxes)}  →  ${displayAddress(plan.to, mailboxes)}`);
    console.log('            (the new address as the login looks it up)');
    console.log(`  Ends:     the password${a.has_password ? '' : ' (none set)'}${a.has_phone ? ', the phone' : ''}, ` +
      `${a.refresh_tokens} session(s), ${a.devices} push device(s), ${a.reset_links} reset link(s), ${a.email_codes} e-mail code(s)` +
      `${a.provider_linked ? ', the Google/Yandex link' : ''}`);
    console.log('  After:    set a new password right away (set-partner-password.js --email=<new address>)');
    if (a.cards > 0) {
      console.log(`  Cards:    the account owns ${a.cards} card(s). Seed and import scripts find the seed house by its flag`);
      console.log('            (mark-service-account.js, after migration 037); until it is set they stop — do not run them.');
    }
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
    console.log(`✅ Moved: account ${account.id} (${account.role}) now stands on ${displayAddress(account.email, mailboxes)}; sign-in ${account.auth_method}; password cleared.`);
    reportEndedSessions(ended);
    console.log(`   E-mail codes spent: ${emailCodes}.`);

    await new Promise((resolveWait) => { setTimeout(resolveWait, SECOND_PASS_DELAY_MS); });
    const second = await secondPass(client, account.id);
    console.log(`   Second pass (${SECOND_PASS_DELAY_MS / 1000} s later): ${second.ended.refreshTokens} session(s), ` +
      `${second.ended.resetLinks} reset link(s), ${second.ended.devices} device(s), ${second.emailCodes} code(s) written meanwhile — ended.`);
    console.log('   Next: set a new password — set-partner-password.js --email=<the new address> (NEW_PASSWORD from the environment).');
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
