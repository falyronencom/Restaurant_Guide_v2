/**
 * Create (or reset) the regular user account given to Apple's reviewers.
 *
 * Since 2026-10-15 (directive service_accounts, B5):
 *   - REVIEW_EMAIL is required: the default used to be an address at a
 *     domain the project does not own, so the account's password resets went
 *     to a stranger. Put it on our mailbox (lib/serviceAccounts.js);
 *   - the password (REVIEW_PASSWORD) is never printed — it used to be;
 *   - an existing account is never deleted and re-created: the script
 *     deleted ANY account with the address, whatever its role, and deleting
 *     an owner of cards takes its cards with it (ON DELETE CASCADE). An
 *     existing ordinary user without cards gets the new password in place,
 *     and every session of it ends (lib/operator-password.js); any other
 *     account is refused.
 *
 * The account stays an ordinary user — not a service account: the review
 * means something only if it behaves as any user does (migration 037).
 *
 * Usage:
 *   DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD=... \
 *   REVIEW_EMAIL=<address> REVIEW_PASSWORD=<password> \
 *   node backend/scripts/create-review-user.js
 */

import argon2 from 'argon2';
import pkg from 'pg';
import { ProductionClient } from './lib/productionDb.js';
import { reportEndedSessions, writePasswordEndingSessions } from './lib/operator-password.js';
import { isOurAddress, loginFormOf, mailboxesFrom } from './lib/serviceAccounts.js';

const { Pool } = pkg;

// A host other than localhost is production: only the server whose
// certificate is pinned (scripts/lib/productionDb.js).
const remote = Boolean(process.env.DB_HOST) && process.env.DB_HOST !== 'localhost';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  ...(remote ? { Client: ProductionClient } : { ssl: false }),
});

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384,
  timeCost: 3,
  parallelism: 1,
};

async function createReviewUser() {
  const email = await loginFormOf(process.env.REVIEW_EMAIL || '');
  const password = process.env.REVIEW_PASSWORD;
  const name = process.env.REVIEW_NAME || 'Apple Reviewer';

  if (!email || !password) {
    console.error('❌ REVIEW_EMAIL and REVIEW_PASSWORD env variables are required (there is no default address).');
    console.error('   Usage: REVIEW_EMAIL=<address> REVIEW_PASSWORD=YourPass node backend/scripts/create-review-user.js');
    await pool.end();
    return 1;
  }

  try {
    const mailboxes = await mailboxesFrom(process.env);
    if (!isOurAddress(email, mailboxes)) {
      console.warn('⚠️  The address is NOT on our mailbox: its password resets reach whoever owns that domain.');
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const existing = await pool.query(
      `SELECT u.id, u.role,
              COALESCE((to_jsonb(u) ->> 'is_service_account')::boolean, false) AS is_service_account,
              (SELECT COUNT(*)::int FROM establishments e WHERE e.partner_id = u.id) AS cards
       FROM users u WHERE lower(u.email) = $1`,
      [email],
    );
    const row = existing.rows[0];

    if (row && (row.role !== 'user' || row.is_service_account || row.cards > 0)) {
      console.error(`❌ An account with this address already exists (role '${row.role}', cards ${row.cards}). This script changes only an ordinary user without cards.`);
      return 1;
    }

    if (row) {
      const client = await pool.connect();
      try {
        const { sessions } = await writePasswordEndingSessions(client, async (tx) => (await tx.query(
          `UPDATE users SET password_hash = $1, name = $2, is_active = true, email_verified = true, updated_at = NOW()
           WHERE id = $3 RETURNING id, email, role, name`,
          [passwordHash, name, row.id],
        )).rows[0]);
        console.log('✅ Review user updated (password: the one in REVIEW_PASSWORD, not printed)');
        reportEndedSessions(sessions);
      } finally {
        client.release();
      }
      return 0;
    }

    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, email, role, name`,
      [email, passwordHash, name, 'user', 'email', true, true],
    );
    console.log(`✅ Review user created: role ${result.rows[0].role}, name ${result.rows[0].name} (password: the one in REVIEW_PASSWORD, not printed)`);
    return 0;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await createReviewUser();
