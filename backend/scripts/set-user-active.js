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
 * And the journal, since 2026-10-18 (tester walkthrough 17.10, P8 report,
 * finding 3): the switch is written as the block from the panel writes it —
 * user_block / user_unblock, entity the account, in the same transaction,
 * timed by clock_timestamp() under the row lock — with the operator script as
 * the actor (user_id NULL) and empty review lists: the script hides and shows
 * no review. Until then the panel's card of a person switched on by the
 * script still showed «Заблокирован» as the latest action, and a later
 * unblock from the panel read an older block's list.
 *
 * A person blocked from the panel is switched on from the panel: the unblock
 * there shows again the reviews the block hid. The script refuses to switch
 * such an account on while some of those reviews are still hidden — unless
 * --keep-reviews-hidden says the reviews stay hidden, as the panel's unticked
 * «Вернуть отзывы» does.
 *
 * Security model (mirrors set-partner-password.js):
 *   - Target database: with --production, DATABASE_URL from
 *     backend/.env.production (gitignored, user-managed; TLS to the pinned
 *     certificate only — scripts/lib/productionDb.js);
 *     without it, the DB_* variables of a local database.
 *   - Refuses to deactivate the last active admin: the panel must keep at
 *     least one account that can act — unless --emergency says that closing
 *     the panel is the point (below).
 *   - Requires typing "yes" to confirm (skip with --yes).
 *
 * Emergency, since 2026-10-24 (Railway incident 21–24.10, finding 9): when the
 * panel's accounts may be in the wrong hands, the panel is closed by switching
 * off its accounts. On 22.10 the last admin could only be switched off by SQL
 * past the journal. Now:
 *   - --emergency lets the switch-off take the last active admin, by the same
 *     path as any switch-off — sessions ended, user_block in the journal (its
 *     reason says it was an emergency) — and prints how to open the panel
 *     again;
 *   - --all-panel-accounts --emergency switches off every active panel account
 *     (admin and viewer) at once, in one transaction, each the same way.
 * Opening it again is the ordinary switch-on of an admin by this script
 * (create-admin.js would also do).
 *
 * Usage:
 *   node scripts/set-user-active.js --email=guest@example.com --active=false --production
 *   node scripts/set-user-active.js --email=guest@example.com --active=true --production
 *   node scripts/set-user-active.js --email=guest@example.com --active=true --keep-reviews-hidden --production
 *   node scripts/set-user-active.js --email=admin@example.com --active=false --emergency --production
 *   node scripts/set-user-active.js --all-panel-accounts --active=false --emergency --production
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';
import dotenv from 'dotenv';
import { ProductionClient } from './lib/productionDb.js';
import { endAllSessions, reportEndedSessions, writePasswordEndingSessions } from './lib/operator-password.js';
import { PANEL_ROLES } from '../src/config/panelRoles.js';

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
const keepReviewsHidden = hasFlag('keep-reviews-hidden');
const emergency = hasFlag('emergency');
const allPanelAccounts = hasFlag('all-panel-accounts');

/** Who the journal names as the actor — the form the other operator scripts use. */
const ACTOR = 'operator_script:set-user-active';

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/set-user-active.js --email=<email> --active=true|false [--keep-reviews-hidden] [--emergency] [--production] [--yes]');
  console.error('   node scripts/set-user-active.js --all-panel-accounts --active=false --emergency [--production] [--yes]');
  process.exit(1);
};

if (allPanelAccounts && email) usage('--all-panel-accounts takes no --email');
if (!allPanelAccounts && (!email || !email.includes('@'))) usage('--email=<email> is required');
if (activeArg !== 'true' && activeArg !== 'false') usage('--active=true or --active=false is required');
const active = activeArg === 'true';
if (emergency && active) usage('--emergency is for switching off (--active=false) only');
if (allPanelAccounts && !emergency) {
  usage('--all-panel-accounts closes the panel to everyone: add --emergency to say that is the point');
}

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

/**
 * Reviews the block in force hid that are still hidden and not deleted: the
 * latest of the block and unblock entries, if it is a block — the same read
 * as adminUserService.unblockUser.
 */
const reviewsHiddenByBlock = async (client, userId) => {
  const latest = await client.query(
    `SELECT action, new_data -> 'hidden_review_ids' AS hidden_review_ids
     FROM audit_log
     WHERE entity_type = 'user' AND entity_id = $1 AND action IN ('user_block', 'user_unblock')
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId],
  );
  const block = latest.rows[0]?.action === 'user_block' ? latest.rows[0] : null;
  const ids = Array.isArray(block?.hidden_review_ids) ? block.hidden_review_ids : [];
  if (ids.length === 0) return 0;
  const hidden = await client.query(
    `SELECT COUNT(*)::int AS count FROM reviews
     WHERE id = ANY($2::uuid[]) AND user_id = $1 AND is_visible = FALSE AND is_deleted = FALSE`,
    [userId, ids],
  );
  return hidden.rows[0].count;
};

/** The journal entry of the switch, in its transaction; fails it when it fails. */
const journal = (tx, accountId, { emergencyClose = false } = {}) => tx.query(
  `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent, created_at)
   VALUES (NULL, $1, 'user', $2, $3, $4, NULL, $5, clock_timestamp())`,
  [
    active ? 'user_unblock' : 'user_block',
    accountId,
    JSON.stringify({ is_active: !active }),
    JSON.stringify(active
      ? {
        is_active: true,
        reason: 'Учётку включил оператор скриптом',
        restore_reviews: false,
        restored_review_ids: [],
        actor: ACTOR,
      }
      : {
        is_active: false,
        reason: emergencyClose
          ? 'Панель закрыта аварийно: учётку выключил оператор скриптом'
          : 'Учётку выключил оператор скриптом',
        hidden_review_ids: [],
        actor: ACTOR,
        ...(emergencyClose ? { emergency: true } : {}),
      }),
    ACTOR,
  ],
);

/** The switch-off of an account, inside the caller's transaction: the row under its lock, then its entry. */
const switchOff = async (tx, accountId, journalOptions) => {
  const row = (await tx.query(
    `UPDATE users SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND is_active = true
     RETURNING id, email, role, is_active`,
    [accountId],
  )).rows[0];
  if (row) await journal(tx, row.id, journalOptions);
  return row;
};

const reopenHint = () => {
  console.log('   To open the panel again, switch an admin back on:');
  console.log(`   node scripts/set-user-active.js --email=<admin e-mail> --active=true${production ? ' --production' : ''}`);
};

const printTarget = (client) => console.log(`Target: ${production
  ? 'PRODUCTION (DATABASE_URL from backend/.env.production)'
  : `local ${client.host}:${client.port}/${client.database}`}`);

/**
 * --all-panel-accounts --emergency: every active panel account off, in one
 * transaction — each as the single switch-off does it (row lock, journal
 * entry, sessions ended). A failure leaves them all as they were.
 */
const closePanel = async (client) => {
  printTarget(client);
  const { rows: accounts } = await client.query(
    'SELECT id, email, name, role FROM users WHERE role = ANY($1::text[]) AND is_active = true ORDER BY role, email',
    [PANEL_ROLES],
  );
  if (accounts.length === 0) {
    console.log('Nothing to do: no panel account is active.');
    return 0;
  }
  console.log(`Active panel accounts: ${accounts.length}`);
  accounts.forEach((a) => console.log(`   ${a.email} (${a.name}), role ${a.role}`));
  console.log('⚠️  EMERGENCY (--all-panel-accounts --emergency): every one of them is switched off; its sessions,');
  console.log('   push devices and unused reset links end. No one can sign in to the panel after this.');
  console.log('   The switches are written to the journal (user_block), as the panel writes a block.');

  if (!skipConfirm && !(await confirm())) {
    console.log('Aborted.');
    return 1;
  }

  const ended = [];
  await client.query('BEGIN');
  try {
    for (const account of accounts) {
      const row = await switchOff(client, account.id, { emergencyClose: true });
      // Switched off meanwhile: nothing of it left to end
      if (row) ended.push({ row, sessions: await endAllSessions(client, row.id) });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  for (const { row, sessions } of ended) {
    console.log(`✅ ${row.email} (${row.role}) is now inactive.`);
    reportEndedSessions(sessions);
  }
  console.log(`The panel is closed: ${ended.length} account(s) switched off.`);
  reopenHint();
  return 0;
};

const main = async () => {
  const client = buildClient();
  await client.connect();
  try {
    if (allPanelAccounts) return await closePanel(client);

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
    printTarget(client);

    if (account.is_active === active) {
      console.log(`Nothing to do: the account is already ${active ? 'active' : 'inactive'}.`);
      return 0;
    }

    let lastAdmin = false;
    if (!active && account.role === 'admin') {
      const admins = await client.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = true",
      );
      lastAdmin = admins.rows[0].count <= 1;
      if (lastAdmin && !emergency) {
        console.error('❌ Refusing: this is the last active admin. Create another admin first (create-admin.js).');
        console.error('   To close the panel on purpose (an emergency), add --emergency.');
        return 1;
      }
    }

    if (active) {
      const hidden = await reviewsHiddenByBlock(client, account.id);
      if (hidden > 0 && !keepReviewsHidden) {
        console.error(`❌ Refusing: the account was blocked from the panel, and ${hidden} of the reviews the block hid are still hidden.`);
        console.error('   Unblock it in the panel (Пользователи → Разблокировать): that shows them again.');
        console.error('   To switch it on here and leave them hidden, add --keep-reviews-hidden.');
        return 1;
      }
      if (hidden > 0) {
        console.log(`   ${hidden} reviews hidden by the panel block stay hidden (--keep-reviews-hidden).`);
      }
    }

    console.log(`Will set is_active = ${active} for ${account.email}; every session, push device and unused reset link of the account ends.`);
    console.log('   The switch is written to the journal (user_block / user_unblock), as the panel writes it.');
    if (!active) {
      console.log('   Login and token refresh stop immediately; an access token already issued stops working within 10 seconds.');
    }
    if (lastAdmin) {
      console.log('⚠️  EMERGENCY (--emergency): this is the last active admin — after the switch no admin can sign in to the panel.');
    }

    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted.');
      return 1;
    }

    // The switch, its journal entry and the revocation in one transaction (the
    // write helper of the password scripts: it ends the sessions of the row
    // the write returns). The UPDATE takes the row lock the panel's actions
    // take first; the entry is written under it.
    const { account: updated, sessions } = await writePasswordEndingSessions(client, async (tx) => {
      if (!active) return switchOff(tx, account.id, { emergencyClose: lastAdmin });
      const row = (await tx.query(
        `UPDATE users SET is_active = true, updated_at = NOW()
         WHERE id = $1 AND is_active = false
         RETURNING id, email, role, is_active`,
        [account.id],
      )).rows[0];
      if (row) await journal(tx, row.id);
      return row;
    });
    if (!updated) {
      console.log('Nothing written: the account was switched meanwhile. Run the script again to see where it stands.');
      return 1;
    }
    console.log(`✅ ${updated.email} (${updated.role}) is now ${updated.is_active ? 'active' : 'inactive'}.`);
    reportEndedSessions(sessions);
    if (lastAdmin) reopenHint();
    return 0;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
