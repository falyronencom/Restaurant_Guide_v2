/**
 * Create a regular user account for Apple Review
 *
 * Usage:
 *   DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD=... \
 *   REVIEW_EMAIL=applereview@test.com REVIEW_PASSWORD=***REDACTED_PASSWORD*** \
 *   node backend/scripts/create-review-user.js
 */

import argon2 from 'argon2';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_HOST && process.env.DB_HOST !== 'localhost'
    ? { rejectUnauthorized: false }
    : false,
});

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384,
  timeCost: 3,
  parallelism: 1,
};

async function createReviewUser() {
  const email = process.env.REVIEW_EMAIL || 'applereview@test.com';
  const password = process.env.REVIEW_PASSWORD || '***REDACTED_PASSWORD***';
  const name = process.env.REVIEW_NAME || 'Apple Reviewer';

  try {
    console.log('Creating review user account...');

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    // Delete existing if exists
    await pool.query('DELETE FROM users WHERE email = $1', [email]);

    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, email, role, name`,
      [email, passwordHash, name, 'user', 'email', true, true]
    );

    console.log('✅ Review user created!');
    console.log(`   Email: ${result.rows[0].email}`);
    console.log(`   Name: ${result.rows[0].name}`);
    console.log(`   Role: ${result.rows[0].role}`);
    console.log(`   Password: ${password}`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

createReviewUser();
