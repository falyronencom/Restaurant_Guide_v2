import argon2 from 'argon2';
import pkg from 'pg';
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

    const email = 'admin@test.com';
    const password = 'Test1453';
    const name = 'Admin';

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    console.log(`Password hash generated: ${passwordHash.substring(0, 30)}...`);

    // Delete existing admin if exists
    await pool.query('DELETE FROM users WHERE email = $1', [email]);

    // Create new admin user
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, email, role, name`,
      [email, passwordHash, name, 'admin', 'email', true, true]
    );

    console.log('✅ Admin created successfully!');
    console.log(`   Email: ${result.rows[0].email}`);
    console.log(`   Name: ${result.rows[0].name}`);
    console.log(`   Role: ${result.rows[0].role}`);
    console.log(`   Password: ${password}`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error.message);
    await pool.end();
    process.exit(1);
  }
}

createAdmin();
