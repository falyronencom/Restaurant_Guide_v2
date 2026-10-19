/**
 * Delete an account at its holder's request to support (brief В1, 18.10.2026)
 * — for a person who cannot press «Удалить учётку» themself: without the app,
 * with a phone account (the site signs in by e-mail only), or with an account
 * the panel switched off (the app answers «Учётка отключена. Напишите в
 * поддержку»). The site's page «Как удалить учётку» sends them to support.
 *
 * The deletion is the app's own — accountDeletionService.anonymiseAccount —
 * in this script's transaction, on this script's connection; what goes and
 * what stays is written there: reviews stay under «Гость», bookings keep date,
 * time and guests, bookings still ahead are cancelled, unfinished drafts go,
 * every session ends; the holder of cards is refused until the cards have
 * another holder. The journal entry user_delete_account has no actor
 * (user_id NULL) and names the script in new_data.actor; the panel reads it
 * as «Учётка удалена по заявке в поддержку».
 *
 * Before running it, support makes sure the request comes from the holder —
 * a reply from the account's address, a code to its phone. The script cannot
 * tell who asked.
 *
 * Where it differs from the app's deletion — the script runs on the
 * operator's machine, outside the server:
 *   - A switched-off account is deleted too (blocked from the panel, or by
 *     set-user-active.js): its holder cannot delete it themself any more. The
 *     reviews a block hid stay hidden.
 *   - The establishments are told of the bookings it cancelled by the notice
 *     the server writes when a guest cancels (bookingCancelledNotice), in the
 *     same transaction — without a push: the script sends none.
 *   - The picture stays on the cloud: the script never calls the cloud — a
 *     local run must not delete a file that a production row still names. It
 *     prints where the picture is, for the Cloudinary console.
 *   - The server's cached account status cannot be dropped from here: a
 *     server process may let an access token already issued through for up to
 *     ACCOUNT_STATUS_TTL_SECONDS; after that the switched-off account refuses
 *     it.
 *   - sessions_revoked_at is stamped by this machine's clock
 *     (accountStatus.markSessionsRevoked) — for a deleted account a backstop
 *     only: no credentials are left, and the account is off.
 *   - The server's modules print their start-up warnings (Firebase: push
 *     disabled) — expected.
 *
 * Refused: panel and service accounts (their access is the operator's —
 * set-user-active.js); the holder of cards. A deleted account keeps no e-mail
 * and no phone, so it is not found: there is nothing left to delete.
 *
 * Security model (as set-user-active.js):
 *   - Target database: with --production, DATABASE_URL of the production
 *     environment (scripts/lib/productionDb.js: loadProductionEnvironment,
 *     TLS to the pinned certificate only); without it, the DB_* variables of a
 *     local database.
 *   - Requires typing "yes" to confirm (skip with --yes).
 *   - Prints the account's id, role and counts — not its name, address or
 *     phone: the output goes into chats and reports.
 *
 * Usage:
 *   node scripts/delete-account.js --email=guest@example.com --production
 *   node scripts/delete-account.js --phone=+375291234567 --production
 *   From a git worktree: node --env-file=<main checkout>/backend/.env.production
 *     scripts/delete-account.js --email=guest@example.com --production
 *
 * Exit: 0 — deleted; 1 — not found, refused, aborted or failed.
 */
import { createInterface } from 'readline';
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import { ACCOUNT_STATUS_TTL_SECONDS } from './lib/operator-password.js';
import { isOperatorManaged, serviceAccountFlagSql } from '../src/config/serviceAccounts.js';
import { ownCloudPublicId, ownedFolders } from '../src/config/cloudinary.js';
import {
  anonymiseAccount,
  holdsCatalogueCards,
  lockAccount,
  wasAccountDeleted,
} from '../src/services/accountDeletionService.js';
import { bookingCancelledNotice } from '../src/services/notificationService.js';

const { Client } = pg;

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const email = (option('email') || '').trim().toLowerCase();
// A phone as the app stores it: +375XXXXXXXXX — spaces, dashes and brackets
// as people write it are dropped.
const phone = (option('phone') || '').replace(/[\s()-]/g, '');
const production = hasFlag('production');
const skipConfirm = hasFlag('yes');

/** Who the journal names as the actor — the form the other operator scripts use. */
const ACTOR = 'operator_script:delete-account';

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/delete-account.js --email=<email> | --phone=<+375XXXXXXXXX> [--production] [--yes]');
  process.exit(1);
};

if (Boolean(email) === Boolean(phone)) usage('exactly one of --email=<email> or --phone=<phone> is required');
if (email && !email.includes('@')) usage('--email=<email> is not an e-mail address');
if (phone && !/^\+\d{7,15}$/.test(phone)) usage('--phone=<phone> is not a phone number: +375XXXXXXXXX');

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

/** The accounts the address or the phone names — one, or none. */
const findAccounts = (client) => client.query(
  `SELECT u.id, u.role, u.auth_method, u.is_active,
          to_char(u.created_at, 'YYYY-MM-DD') AS registered,
          ${serviceAccountFlagSql('u')} AS is_service_account
   FROM users u
   WHERE ${email ? 'LOWER(u.email) = $1' : 'u.phone = $1'}`,
  [email || phone],
);

/**
 * The deletion, its notices and nothing else in one transaction; the account
 * is judged again under its row lock — the person may have deleted it, or the
 * operator marked it a service account, since the question.
 *
 * @returns {Promise<{outcome?: Object, account?: Object, notices?: number, refusal?: string, deleted?: boolean}>}
 */
const deleteInTransaction = async (client, accountId) => {
  await client.query('BEGIN');
  try {
    const account = await lockAccount(client, accountId);
    if (!account) {
      await client.query('ROLLBACK');
      return { refusal: 'The account is gone meanwhile — nothing written.' };
    }
    if (!account.is_active && await wasAccountDeleted(client, account.id)) {
      await client.query('ROLLBACK');
      return { deleted: true };
    }
    if (isOperatorManaged(account)) {
      await client.query('ROLLBACK');
      return { refusal: 'A panel or service account: its access is the operator\'s — switch it off with set-user-active.js.' };
    }

    const outcome = await anonymiseAccount(client, account, { userId: null, label: ACTOR });

    let notices = 0;
    for (const booking of outcome.cancelled) {
      if (!booking.partner_id) continue;
      const notice = bookingCancelledNotice(booking);
      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, establishment_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [booking.partner_id, notice.type, notice.title, notice.message, booking.establishment_id],
      );
      notices += 1;
    }

    await client.query('COMMIT');
    return { outcome, account, notices };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === 'ACCOUNT_OWNS_ESTABLISHMENTS') {
      return { refusal: 'The account holds establishment cards: pass them to another holder first — nothing written.' };
    }
    throw error;
  }
};

const main = async () => {
  let client;
  try {
    client = buildClient();
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
    const found = (await findAccounts(client)).rows;
    if (found.length === 0) {
      console.error(`❌ No account with this ${email ? 'e-mail' : 'phone'}. A deleted account keeps neither: if its holder deleted it, there is nothing to do.`);
      return 1;
    }
    if (found.length > 1) {
      console.error(`❌ ${found.length} accounts answer to this ${email ? 'e-mail (in different case)' : 'phone'} — nothing written; settle which one in the database first.`);
      return 1;
    }
    const target = found[0];

    console.log(`Account ${target.id}: role ${target.role}, sign-in ${target.auth_method}, `
      + `${target.is_active ? 'active' : 'switched off'}, registered ${target.registered}`);
    console.log(`Target: ${production
      ? 'PRODUCTION (DATABASE_URL of the production environment)'
      : `local ${client.host}:${client.port}/${client.database}`}`);

    if (isOperatorManaged(target)) {
      console.error('❌ Refusing: a panel or service account — its access is the operator\'s. Switch it off with set-user-active.js.');
      return 1;
    }
    if (await holdsCatalogueCards(client, target.id)) {
      console.error('❌ Refusing: the account holds establishment cards. Pass them to another holder first, then run the script again.');
      return 1;
    }

    console.log('Will delete the account as «Удалить учётку» in the app does: its contacts, sign-in, sessions,');
    console.log('   favourites, notices and unfinished drafts go; reviews stay under «Гость»; bookings keep date,');
    console.log('   time and guests, and those still ahead are cancelled — the establishment gets a notice.');
    console.log('   This cannot be undone.');

    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted — nothing was written.');
      return 1;
    }

    const result = await deleteInTransaction(client, target.id);
    if (result.deleted) {
      console.log('Nothing written: the account was deleted meanwhile.');
      return 0;
    }
    if (result.refusal) {
      console.error(`❌ ${result.refusal}`);
      return 1;
    }

    const { counts } = result.outcome;
    console.log(`✅ Account ${target.id} deleted: ${counts.reviews_kept} review(s) kept under «Гость», `
      + `${counts.bookings_cancelled} booking(s) ahead cancelled (${result.notices} establishment notice(s), no push), `
      + `${counts.favorites_removed} favourite(s) removed, ${counts.drafts_deleted} unfinished card(s) deleted; every session ended.`);
    const avatarUrl = result.account.avatar_url;
    if (avatarUrl) {
      const publicId = ownCloudPublicId(avatarUrl);
      console.log(publicId
        ? `   The picture is left on the cloud: delete ${publicId} in the Cloudinary console (Media Library).`
        : '   The picture is not on the cloud this machine is set up for (a Google or Yandex picture — or CLOUDINARY_* '
          + `not set here): look into ${ownedFolders.avatars(target.id)} in the Cloudinary console.`);
    }
    console.log(`   A server process may let an old access token through for up to ${ACCOUNT_STATUS_TTL_SECONDS} seconds.`);
    return 0;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
