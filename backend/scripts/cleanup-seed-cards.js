/**
 * Production cleanup — remove placeholder/test establishment cards before the
 * real seed fill-up.
 *
 * Targets (by OWNER, not by is_seed — the two groups differ):
 *   1. house  = seed.data.generator@restaurantguide.by  (77 placeholder cards)
 *   2. test   = evgenia.schasnovich@gmail.com           (12 test cards)
 *
 * The USER ACCOUNTS ARE KEPT — only their establishments are deleted. The house
 * account stays (it owns the cards a collector will create through the cabinet).
 *
 * Safety model (mirrors apply-migration-production.js + the seed-import rollback):
 *   - Reads DATABASE_URL from backend/.env.production (never printed).
 *   - Writes a JSON BACKUP of every row about to die FIRST (establishments,
 *     media, reviews, favorites) — restore material if anything goes wrong.
 *   - Reports the full blast radius, flagging REAL (non-seed) user data.
 *   - --report-only stops before touching anything.
 *   - Deletes inside a TRANSACTION; FKs cascade to media/reviews/favorites.
 *
 * Usage:
 *   node scripts/cleanup-seed-cards.js --report-only     # inspect, change nothing
 *   node scripts/cleanup-seed-cards.js                   # backup + confirm + delete
 *   node scripts/cleanup-seed-cards.js --yes             # skip the prompt
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');
const envPath = join(backendRoot, '.env.production');

if (!existsSync(envPath)) {
  console.error('❌ Missing backend/.env.production (needs DATABASE_URL).');
  process.exit(1);
}
dotenv.config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set.'); process.exit(1); }

const args = process.argv.slice(2);
const reportOnly = args.includes('--report-only');
const skipConfirm = args.includes('--yes');

/** Default targets = the original placeholder/test owners. Override with
 *  --emails=a@b.by,c@d.com to clean a different owner set (same safety rails). */
const DEFAULT_TARGET_EMAILS = [
  'seed.data.generator@restaurantguide.by',
  'evgenia.schasnovich@gmail.com',
];
const emailsArg = args.find((a) => a.startsWith('--emails='));
const TARGET_EMAILS = emailsArg
  ? emailsArg.slice('--emails='.length).split(',').map((e) => e.trim()).filter(Boolean)
  : DEFAULT_TARGET_EMAILS;

const hostDisplay = (() => {
  try { const u = new URL(DATABASE_URL); return `${u.hostname}:${u.port}${u.pathname}`; }
  catch { return '(unparseable)'; }
})();

function confirm(msg) {
  if (skipConfirm) return Promise.resolve(true);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(`${msg} Type "yes" to confirm: `, (a) => {
    rl.close(); res(a.trim().toLowerCase() === 'yes');
  }));
}

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  // ── Resolve owners ────────────────────────────────────────────────────────
  const owners = await client.query(
    'SELECT id, email FROM users WHERE email = ANY($1)', [TARGET_EMAILS],
  );
  if (!owners.rows.length) { console.error('❌ None of the target accounts exist.'); await client.end(); process.exit(1); }
  const ownerIds = owners.rows.map((r) => r.id);

  // ── Cards to delete ───────────────────────────────────────────────────────
  const cards = await client.query(
    `SELECT e.id, e.name, e.city, e.status, e.is_seed, e.claimed_at, e.created_at, e.partner_id, u.email AS owner
       FROM establishments e JOIN users u ON u.id = e.partner_id
      WHERE e.partner_id = ANY($1) ORDER BY u.email, e.created_at`,
    [ownerIds],
  );
  const cardIds = cards.rows.map((r) => r.id);

  console.log('\n════════════════════════════════════════════════');
  console.log('  SEED/TEST CARD CLEANUP — production');
  console.log('════════════════════════════════════════════════');
  console.log(`  Host: ${hostDisplay}`);
  for (const o of owners.rows) {
    const n = cards.rows.filter((c) => c.partner_id === o.id).length;
    console.log(`  ${o.email} → ${n} cards`);
  }
  console.log(`  TOTAL cards to delete: ${cardIds.length}`);

  if (!cardIds.length) { console.log('\nNothing to delete.'); await client.end(); return; }

  // Small sets: list every card by name so the operator sees exactly what dies.
  if (cards.rows.length <= 20) {
    console.log('\n  Cards:');
    for (const c of cards.rows) {
      console.log(`    - "${c.name}" [${c.city}] status=${c.status} is_seed=${c.is_seed} owner=${c.owner} created=${c.created_at ? String(c.created_at).slice(0, 10) : '?'}`);
    }
  }

  // ── Blast radius (cascade) ────────────────────────────────────────────────
  const related = {};
  // media has no user_id — count rows only. The user-owned tables additionally
  // split out rows belonging to REAL users (seed.user* are the fake reviewers).
  try {
    const r = await client.query(
      'SELECT COUNT(*)::int AS total FROM establishment_media WHERE establishment_id = ANY($1)',
      [cardIds],
    );
    related.establishment_media = { total: r.rows[0].total, real_users: 0 };
  } catch { related.establishment_media = { total: 0, real_users: 0, note: 'absent' }; }

  for (const table of ['reviews', 'favorites', 'bookings']) {
    try {
      const r = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.email IS NULL OR u.email NOT ILIKE 'seed.user%')::int AS real_users
           FROM ${table} t
           LEFT JOIN users u ON u.id = t.user_id
          WHERE t.establishment_id = ANY($1)`,
        [cardIds],
      );
      related[table] = r.rows[0];
    } catch { related[table] = { total: 0, real_users: 0, note: 'table/column absent' }; }
  }
  console.log('\n  Cascade will also remove:');
  for (const [t, v] of Object.entries(related)) {
    console.log(`    ${t}: ${v.total}${v.real_users ? `  (⚠ ${v.real_users} from REAL users)` : ''}`);
  }

  // Claimed cards are a hard stop — never delete something a real owner took over.
  const claimed = cards.rows.filter((c) => c.claimed_at);
  if (claimed.length) {
    console.error(`\n❌ ABORT: ${claimed.length} card(s) are CLAIMED by a real owner:`);
    claimed.forEach((c) => console.error(`   - ${c.name} (${c.owner})`));
    await client.end(); process.exit(1);
  }

  // Where the media actually lives (orphan-asset awareness).
  const hosts = await client.query(
    `SELECT COALESCE(substring(url from 'https?://([^/]+)'), '(none)') AS host, COUNT(*)::int AS n
       FROM establishment_media WHERE establishment_id = ANY($1) GROUP BY 1 ORDER BY n DESC`,
    [cardIds],
  );
  if (hosts.rows.length) {
    console.log('\n  Media hosts (files themselves are NOT deleted by this script):');
    hosts.rows.forEach((h) => console.log(`    ${h.host}: ${h.n}`));
  }

  // ── Backup BEFORE any write ───────────────────────────────────────────────
  const dump = { takenAt: new Date().toISOString(), host: hostDisplay, owners: owners.rows, cards: cards.rows };
  for (const table of ['establishment_media', 'reviews', 'favorites']) {
    try {
      const r = await client.query(`SELECT * FROM ${table} WHERE establishment_id = ANY($1)`, [cardIds]);
      dump[table] = r.rows;
    } catch { dump[table] = []; }
  }
  const stamp = dump.takenAt.replace(/[:.]/g, '-');
  const backupPath = join(backendRoot, `cleanup-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(dump, null, 2), 'utf8');
  console.log(`\n  ✅ Backup written: ${backupPath}`);

  if (reportOnly) {
    console.log('\n--report-only: nothing was deleted.');
    await client.end(); return;
  }

  console.log('\n  ⚠  This DELETE is irreversible (backup above is your restore material).');
  if (!(await confirm(`  Delete ${cardIds.length} cards?`))) {
    console.log('Aborted — no changes made.');
    await client.end(); return;
  }

  // ── Delete in a transaction ───────────────────────────────────────────────
  try {
    await client.query('BEGIN');
    const del = await client.query('DELETE FROM establishments WHERE id = ANY($1)', [cardIds]);
    await client.query('COMMIT');
    console.log(`\n✅ Deleted ${del.rowCount} establishments (cascade removed their media/reviews/favorites).`);
    console.log('   User accounts were KEPT (house account intact for cabinet entry).');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Delete failed, rolled back:', e.message);
    process.exitCode = 1;
  }

  const left = await client.query(
    'SELECT COUNT(*)::int AS n FROM establishments WHERE partner_id = ANY($1)', [ownerIds],
  );
  console.log(`   Cards still owned by these accounts: ${left.rows[0].n}`);
  const total = await client.query('SELECT COUNT(*)::int AS n FROM establishments');
  console.log(`   Establishments remaining in DB: ${total.rows[0].n}`);
}

main()
  .then(() => client.end())
  .catch(async (e) => { console.error('❌ Failed:', e.message); try { await client.end(); } catch {} process.exit(1); });
