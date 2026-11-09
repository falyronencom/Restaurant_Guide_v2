/**
 * Erase what accounts deleted earlier still keep (critic 2Г, items 2.01–2.03
 * and П3-02; 10.11.2026). The deletion of an account erases more since then:
 *   - the text of the person's reviews nobody but the panel reads — deleted by
 *     the person or by a moderator, hidden by a moderator or by a block
 *     (Coordinator, 09.11.2026: «стирать»);
 *   - the organisation's name, the УНП and the scan link of a legal record
 *     left under the person's id;
 *   - and nothing is written under the account by a request that raced the
 *     deletion: a favourite (and the card's counter), a push device, settings,
 *     a notice, a reset link, a code, a draft card.
 * An account deleted before keeps what the deletion of its day left. This
 * script finds every deleted account — switched off and marked by its journal
 * entry user_delete_account — and applies to it the same erasure the deletion
 * applies now (accountDeletionService.eraseLeftovers), plus the deletion's
 * first step: the account's unfinished cards nobody else has used go, each
 * with its journal entry, as the partner's own delete. A card that was or is
 * in the catalogue is not deleted: the script lists it — the panel passes it
 * to another holder («передать»).
 *
 * Without --apply nothing is kept: each account's erasure runs in its
 * transaction and is rolled back, and the counts are what --apply would
 * change. That is the list «до»; after --apply the same run without it shows
 * zeros — «после».
 *
 * Prints account ids, card ids and counts — no name, address or text: the
 * output goes into chats and reports.
 *
 * Security model (as delete-account.js):
 *   - Target database: with --production, DATABASE_URL of the production
 *     environment (scripts/lib/productionDb.js: loadProductionEnvironment, TLS
 *     to the pinned certificate only); without it, the DB_* variables of a
 *     local database — the restore of a snapshot, for the list before the
 *     word. The target is printed first; an unknown argument is refused.
 *   - --apply asks for "yes" (skip with --yes).
 *   - The server's database pool is made to refuse: a helper that ever
 *     reaches for it fails the run instead of writing somewhere else.
 *
 * Usage:
 *   node scripts/erase-deleted-account-leftovers.js                 # local, nothing kept
 *   node scripts/erase-deleted-account-leftovers.js --production    # production, nothing kept
 *   node scripts/erase-deleted-account-leftovers.js --production --apply
 *   From a git worktree: node --env-file=<main checkout>/backend/.env.production
 *     scripts/erase-deleted-account-leftovers.js --production
 *
 * Exit: 0 — done (or nothing to do); 1 — refused, aborted or failed.
 */
import { createInterface } from 'readline';
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import serverPool from '../src/config/database.js';
import {
  ACCOUNT_DELETED_ACTION,
  deleteUnfinishedCards,
  eraseLeftovers,
  lockAccount,
  wasAccountDeleted,
} from '../src/services/accountDeletionService.js';

const { Client } = pg;

const refuseServerPool = () => {
  throw new Error('erase-deleted-account-leftovers: the server\'s database pool is not the database this script writes');
};
serverPool.query = refuseServerPool;
serverPool.connect = refuseServerPool;

const args = process.argv.slice(2);
const KNOWN = ['--production', '--apply', '--yes'];
const unknown = args.filter((a) => !KNOWN.includes(a)).map((a) => a.split('=')[0]);
if (unknown.length > 0) {
  console.error(`❌ unknown argument: ${unknown.join(' ')}`);
  console.error('   node scripts/erase-deleted-account-leftovers.js [--production] [--apply] [--yes]');
  process.exit(1);
}
const production = args.includes('--production');
const apply = args.includes('--apply');
const skipConfirm = args.includes('--yes');

/** Who the journal names as the actor of a card it deletes. */
const ACTOR = 'operator_script:erase-deleted-account-leftovers';

/** The steps, in the order the table prints them. */
const STEPS = Object.freeze([
  ['review_texts', 'texts of invisible reviews'],
  ['partner_documents', 'legal records with data'],
  ['favorites', 'favourites'],
  ['notifications', 'notices'],
  ['notification_preferences', 'notice settings'],
  ['device_tokens', 'push devices'],
  ['email_verification_codes', 'e-mail codes'],
  ['password_reset_tokens', 'reset links'],
  ['refresh_tokens', 'sessions'],
  ['booking_contacts', 'bookings with a phone or comment'],
  ['journal_entries', 'journal entries with a name or address'],
  ['cards_deleted', 'unfinished cards'],
]);

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

/** Every deleted account: switched off, with its deletion's journal entry. */
const findDeletedAccounts = (client) => client.query(
  `SELECT u.id FROM users u
   WHERE u.is_active = FALSE
     AND EXISTS (SELECT 1 FROM audit_log a
                 WHERE a.entity_type = 'user' AND a.entity_id = u.id AND a.action = $1)
   ORDER BY u.id`,
  [ACCOUNT_DELETED_ACTION],
);

/**
 * One account, in its own transaction, under its row lock: the deletion's
 * erasure again, then the cards still held. Kept with --apply, rolled back
 * without it.
 *
 * @returns {Promise<{changed: Object, held: Array<{id: string, status: string}>}|null>}
 *   null when the account is no longer a deleted one
 */
const sweepAccount = async (client, accountId) => {
  await client.query('BEGIN');
  try {
    const account = await lockAccount(client, accountId);
    if (!account || account.is_active || !(await wasAccountDeleted(client, accountId))) {
      await client.query('ROLLBACK');
      return null;
    }
    const cardsDeleted = await deleteUnfinishedCards(client, accountId, { label: ACTOR });
    const changed = { ...(await eraseLeftovers(client, accountId)), cards_deleted: cardsDeleted };
    const held = (await client.query(
      'SELECT id, status FROM establishments WHERE partner_id = $1 ORDER BY id',
      [accountId],
    )).rows;
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { changed, held };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
};

const main = async () => {
  let client;
  try {
    client = buildClient();
    await client.connect();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
  try {
    console.log(`Target: ${production
      ? 'PRODUCTION (DATABASE_URL of the production environment)'
      : `local ${client.host}:${client.port}/${client.database}`}`);
    console.log(apply ? 'Mode: --apply — the erasure is kept.' : 'Mode: list — every change is rolled back.');

    const accounts = (await findDeletedAccounts(client)).rows.map((row) => row.id);
    console.log(`Deleted accounts: ${accounts.length}`);
    if (accounts.length === 0) return 0;

    if (apply && !skipConfirm) {
      console.log('Will erase, for each of them, what the deletion erases now. This cannot be undone.');
      if (!(await confirm())) {
        console.log('Aborted — nothing was written.');
        return 1;
      }
    }

    const totals = Object.fromEntries(STEPS.map(([key]) => [key, 0]));
    const heldCards = [];
    let touched = 0;
    for (const accountId of accounts) {
      const result = await sweepAccount(client, accountId);
      if (!result) continue;
      const nonZero = STEPS.filter(([key]) => result.changed[key] > 0);
      if (nonZero.length > 0) {
        touched += 1;
        console.log(`  ${accountId}: ${nonZero.map(([key]) => `${key} ${result.changed[key]}`).join(', ')}`);
      }
      for (const [key] of STEPS) totals[key] += result.changed[key] || 0;
      for (const card of result.held) heldCards.push({ accountId, ...card });
    }

    console.log(`${apply ? 'Erased' : 'Would erase'} — accounts with something left: ${touched} of ${accounts.length}`);
    for (const [key, label] of STEPS) {
      console.log(`  ${label}: ${totals[key]}`);
    }
    if (heldCards.length > 0) {
      console.log(`Cards held by deleted accounts (not deleted — pass each to another holder in the panel): ${heldCards.length}`);
      for (const card of heldCards) console.log(`  card ${card.id} (${card.status}) — account ${card.accountId}`);
    } else {
      console.log('Cards held by deleted accounts: 0');
    }
    return 0;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
