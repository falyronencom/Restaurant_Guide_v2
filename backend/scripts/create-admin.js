import argon2 from 'argon2';
import pkg from 'pg';
import { reportEndedSessions, writePasswordEndingSessions } from './lib/operator-password.js';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres_dev_password',
});

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384,
  timeCost: 3,
  parallelism: 1,
};

async function createAdmin() {
  try {
    console.log('Creating admin account...');

    const email = process.env.ADMIN_EMAIL || 'admin@test.com';
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME || 'Admin';

    if (!password) {
      console.error('❌ ADMIN_PASSWORD env variable is required.');
      console.error('   Usage: ADMIN_PASSWORD=YourSecurePass node backend/scripts/create-admin.js');
      process.exit(1);
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    console.log(`Password hash generated: ${passwordHash.substring(0, 30)}...`);

    // Try to update existing admin first, create if not exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);

    let account;
    let sessions = null;
    if (existing.rows.length > 0) {
      // A new password ends every session of the account, as a password reset
      // does (lib/operator-password.js).
      const client = await pool.connect();
      try {
        ({ account, sessions } = await writePasswordEndingSessions(client, async (tx) => (await tx.query(
          `UPDATE users SET password_hash = $1, name = $2, role = 'admin', is_active = true, updated_at = NOW()
           WHERE email = $3
           RETURNING id, email, role, name`,
          [passwordHash, name, email],
        )).rows[0]));
      } finally {
        client.release();
      }
      console.log('✅ Admin password updated successfully!');
    } else {
      const result = await pool.query(
        `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id, email, role, name`,
        [email, passwordHash, name, 'admin', 'email', true, true]
      );
      account = result.rows[0];
      console.log('✅ Admin created successfully!');
    }
    console.log(`   Email: ${account.email}`);
    console.log(`   Name: ${account.name}`);
    console.log(`   Role: ${account.role}`);
    console.log(`   Password: ${password}`);
    if (sessions) reportEndedSessions(sessions);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error.message);
    await pool.end();
    process.exit(1);
  }
}

createAdmin();
