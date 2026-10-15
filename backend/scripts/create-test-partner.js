/**
 * Create (or reset) a partner account for testing the partner cabinet.
 *
 * Since 2026-10-15 (directive service_accounts, B5):
 *   - PARTNER_EMAIL is required: the script used to write a fixed address at
 *     a domain the project does not own;
 *   - the password (PARTNER_PASSWORD) is never printed;
 *   - an existing account is never deleted and re-created: deleting an owner
 *     of cards takes its cards with it (ON DELETE CASCADE). An existing
 *     partner gets the new password in place, and every session of it ends
 *     (lib/operator-password.js); any other account — another role, or the
 *     seed house — is refused.
 *
 * Local database only (DB_* variables).
 *
 * Usage:
 *   PARTNER_EMAIL=partner@example.com PARTNER_PASSWORD=... node backend/scripts/create-test-partner.js
 */
import argon2 from 'argon2';
import pkg from 'pg';
import { reportEndedSessions, writePasswordEndingSessions } from './lib/operator-password.js';
import { loginFormOf } from './lib/serviceAccounts.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres_dev_password',
});

async function createTestPartner() {
  const password = process.env.PARTNER_PASSWORD;
  const email = await loginFormOf(process.env.PARTNER_EMAIL || '');
  if (!email || !password) {
    console.error('❌ PARTNER_EMAIL and PARTNER_PASSWORD env variables are required.');
    console.error('   Usage: PARTNER_EMAIL=partner@example.com PARTNER_PASSWORD=YourPass node backend/scripts/create-test-partner.js');
    await pool.end();
    return 1;
  }

  try {
    // Library-default Argon2 parameters, as this script always used
    // (unit/passwordHashCompat.test.js keeps such hashes verifying).
    const passwordHash = await argon2.hash(password);

    const existing = await pool.query(
      `SELECT id, role, COALESCE((to_jsonb(users) ->> 'is_service_account')::boolean, false) AS is_service_account
       FROM users WHERE lower(email) = $1`,
      [email],
    );
    const row = existing.rows[0];

    if (row && (row.role !== 'partner' || row.is_service_account)) {
      console.error(`❌ ${email} already exists (role '${row.role}'${row.is_service_account ? ', service account' : ''}). This script changes only an ordinary partner.`);
      return 1;
    }

    if (row) {
      const client = await pool.connect();
      try {
        const { sessions } = await writePasswordEndingSessions(client, async (tx) => (await tx.query(
          `UPDATE users SET password_hash = $1, is_active = true, updated_at = NOW()
           WHERE id = $2 RETURNING id, email, role`,
          [passwordHash, row.id],
        )).rows[0]);
        console.log(`✅ Test partner updated: ${email} (password: the one in PARTNER_PASSWORD, not printed)`);
        reportEndedSessions(sessions);
      } finally {
        client.release();
      }
      return 0;
    }

    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, email, role`,
      [email, passwordHash, 'Test Partner', 'partner', 'email', true],
    );
    console.log(`✅ Test partner created: ${result.rows[0].email}, role ${result.rows[0].role} (password: the one in PARTNER_PASSWORD, not printed)`);
    return 0;
  } catch (error) {
    console.error('❌ Error creating test partner:', error.message);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await createTestPartner();
