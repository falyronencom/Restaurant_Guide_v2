/**
 * Seed Reviews & Users Script
 *
 * Populates the database with seed users and reviews for existing seed
 * establishments. Creates a realistic-looking platform for closed testing.
 *
 * Usage:
 *   node backend/scripts/seed-reviews.js
 *
 * Prerequisites:
 *   - PostgreSQL running with schema applied
 *   - Seed establishments already created (seed-establishments.js)
 *
 * Idempotent: safe to run multiple times — cleans existing seed reviews first.
 */

import pg from 'pg';
import argon2 from 'argon2';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  SEED_USERS,
  SEED_USER_PASSWORD,
  REVIEW_TEMPLATES,
  PARTNER_RESPONSES,
  createSeededRandom,
  randomInt,
  pickFrom,
  getTargetReviewCount,
  getCategoryGroup,
  pickRating,
  getRatingTier,
  generateReviewDate,
  generateResponseDate,
} from './seed-data/reviews-config.js';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

const SEED_PARTNER_EMAIL = 'seed.data.generator@restaurantguide.by';
const SEED_RANDOM_SEED = 20260226; // deterministic seed

// ─── Database Operations ───────────────────────────────────────────────────

/**
 * Find seed partner account
 */
async function getSeedPartner(client) {
  const result = await client.query(
    'SELECT id FROM users WHERE email = $1',
    [SEED_PARTNER_EMAIL],
  );
  if (result.rows.length === 0) {
    throw new Error(
      `Seed partner not found (${SEED_PARTNER_EMAIL}). Run seed-establishments.js first.`,
    );
  }
  return result.rows[0].id;
}

/**
 * Get or create seed user accounts (12 users)
 * Returns array of { id, email, name }
 */
async function getOrCreateSeedUsers(client) {
  const passwordHash = await argon2.hash(SEED_USER_PASSWORD);

  const users = [];

  for (const user of SEED_USERS) {
    // Check if user already exists
    const existing = await client.query(
      'SELECT id, email, name FROM users WHERE email = $1',
      [user.email],
    );

    if (existing.rows.length > 0) {
      users.push(existing.rows[0]);
      continue;
    }

    // Create new seed user
    const result = await client.query(
      `INSERT INTO users (email, password_hash, name, role, auth_method, email_verified, is_active)
       VALUES ($1, $2, $3, 'user', 'email', true, true)
       RETURNING id, email, name`,
      [user.email, passwordHash, user.name],
    );

    users.push(result.rows[0]);
  }

  return users;
}

/**
 * Load active seed establishments
 */
async function loadSeedEstablishments(client, partnerId) {
  const result = await client.query(
    `SELECT id, name, city, categories
     FROM establishments
     WHERE partner_id = $1 AND status = 'active'
     ORDER BY city, name`,
    [partnerId],
  );
  return result.rows;
}

/**
 * Delete existing reviews by seed users (for idempotency)
 * Returns IDs of affected establishments for aggregate recalculation
 */
async function cleanExistingSeedReviews(client, userIds) {
  if (userIds.length === 0) return [];

  // Get affected establishment IDs before deletion
  const affectedResult = await client.query(
    `SELECT DISTINCT establishment_id FROM reviews WHERE user_id = ANY($1)`,
    [userIds],
  );
  const affectedIds = affectedResult.rows.map(r => r.establishment_id);

  // Delete reviews
  const deleteResult = await client.query(
    'DELETE FROM reviews WHERE user_id = ANY($1)',
    [userIds],
  );

  if (deleteResult.rowCount > 0) {
    console.log(`  🧹 Deleted ${deleteResult.rowCount} existing seed reviews`);
  }

  return affectedIds;
}

/**
 * Insert a single review
 */
async function insertReview(client, { userId, establishmentId, rating, content, createdAt, partnerResponse, partnerResponseAt, partnerResponderId }) {
  const query = `
    INSERT INTO reviews (user_id, establishment_id, rating, content, text, partner_response, partner_response_at, partner_responder_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $8)
    RETURNING id
  `;

  const values = [
    userId,
    establishmentId,
    rating,
    content,
    partnerResponse || null,
    partnerResponseAt || null,
    partnerResponderId || null,
    createdAt,
  ];

  const result = await client.query(query, values);
  return result.rows[0].id;
}

/**
 * Recalculate aggregates for establishments
 */
async function recalculateAggregates(client, establishmentIds) {
  for (const id of establishmentIds) {
    await client.query(
      `UPDATE establishments
       SET
         average_rating = COALESCE(
           (SELECT AVG(rating)::DECIMAL(3,2) FROM reviews WHERE establishment_id = $1 AND is_deleted = false),
           0.0
         ),
         review_count = (
           SELECT COUNT(*) FROM reviews WHERE establishment_id = $1 AND is_deleted = false
         ),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id],
    );
  }
}

// ─── Review Generation ─────────────────────────────────────────────────────

/**
 * Generate all review assignments for establishments
 */
function generateReviewPlan(establishments, users, randomFn) {
  const plan = []; // { establishmentId, userId, rating, content, createdAt, hasPartnerResponse }
  const usedPairs = new Set(); // track user-establishment pairs

  // Track per-template usage to rotate through templates evenly
  const templateCounters = {};

  for (const est of establishments) {
    const reviewCount = getTargetReviewCount(est.city, est.categories, randomFn);
    if (reviewCount === 0) continue;

    const group = getCategoryGroup(est.categories);
    const templates = REVIEW_TEMPLATES[group];
    if (!templates) continue;

    // Shuffle users for this establishment
    const shuffledUsers = [...users].sort(() => randomFn() - 0.5);

    for (let i = 0; i < reviewCount && i < shuffledUsers.length; i++) {
      const user = shuffledUsers[i];
      const pairKey = `${user.id}:${est.id}`;

      // Skip if this user already reviewed this establishment
      if (usedPairs.has(pairKey)) continue;
      usedPairs.add(pairKey);

      const rating = pickRating(randomFn);
      const tier = getRatingTier(rating);
      const tierTemplates = templates[tier];

      // Rotate through templates to minimize repetition
      const counterKey = `${group}:${tier}`;
      if (!templateCounters[counterKey]) templateCounters[counterKey] = 0;
      const templateIndex = templateCounters[counterKey] % tierTemplates.length;
      templateCounters[counterKey]++;

      const content = tierTemplates[templateIndex];
      const createdAt = generateReviewDate(randomFn);
      const hasPartnerResponse = randomFn() < 0.25; // ~25%

      plan.push({
        establishmentId: est.id,
        establishmentName: est.name,
        userId: user.id,
        userName: user.name,
        rating,
        content,
        createdAt,
        hasPartnerResponse,
      });
    }
  }

  // Sort by createdAt for natural insertion order
  plan.sort((a, b) => a.createdAt - b.createdAt);

  return plan;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function seed() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   🌱 Seed Reviews & Users — Restaurant Guide Belarus');
  console.log('═══════════════════════════════════════════════════════\n');

  let client;

  try {
    client = await pool.connect();
    console.log('✓ Database connection established\n');

    await client.query('BEGIN');

    // 1. Find seed partner
    const partnerId = await getSeedPartner(client);
    console.log('✓ Seed partner found\n');

    // 2. Get or create seed users
    console.log('👥 Setting up seed users:\n');
    const users = await getOrCreateSeedUsers(client);
    const newCount = users.length;
    console.log(`  ✓ ${newCount} seed users ready\n`);

    // 3. Clean existing seed reviews (idempotency)
    const userIds = users.map(u => u.id);
    const previouslyAffected = await cleanExistingSeedReviews(client, userIds);

    // 4. Load seed establishments
    const establishments = await loadSeedEstablishments(client, partnerId);
    if (establishments.length === 0) {
      throw new Error('No active seed establishments found. Run seed-establishments.js first.');
    }
    console.log(`\n✓ Found ${establishments.length} active seed establishments\n`);

    // 5. Generate review plan
    const randomFn = createSeededRandom(SEED_RANDOM_SEED);
    const plan = generateReviewPlan(establishments, users, randomFn);
    console.log(`📝 Generating ${plan.length} reviews:\n`);

    // 6. Insert reviews
    const stats = {
      total: 0,
      byRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      withResponse: 0,
      byCity: {},
      establishmentsWithReviews: new Set(),
    };

    // Prepare partner response data
    const responseRandomFn = createSeededRandom(SEED_RANDOM_SEED + 1000);

    for (const item of plan) {
      let partnerResponse = null;
      let partnerResponseAt = null;
      let partnerResponderId = null;

      if (item.hasPartnerResponse) {
        const tier = getRatingTier(item.rating);
        const responses = PARTNER_RESPONSES[tier];
        partnerResponse = pickFrom(responses, responseRandomFn);
        partnerResponseAt = generateResponseDate(item.createdAt, responseRandomFn);
        partnerResponderId = partnerId;
      }

      await insertReview(client, {
        userId: item.userId,
        establishmentId: item.establishmentId,
        rating: item.rating,
        content: item.content,
        createdAt: item.createdAt,
        partnerResponse,
        partnerResponseAt,
        partnerResponderId,
      });

      stats.total++;
      stats.byRating[item.rating]++;
      if (item.hasPartnerResponse) stats.withResponse++;
      stats.establishmentsWithReviews.add(item.establishmentId);

      // Progress logging every 50 reviews
      if (stats.total % 50 === 0) {
        console.log(`  ... ${stats.total} reviews inserted`);
      }
    }

    console.log(`  ✓ ${stats.total} reviews inserted\n`);

    // 7. Recalculate aggregates for ALL seed establishments (including those with 0 reviews)
    console.log('📊 Recalculating establishment aggregates...');
    const allEstablishmentIds = establishments.map(e => e.id);
    // Also include previously affected establishments (in case we deleted reviews from them)
    const allIds = [...new Set([...allEstablishmentIds, ...previouslyAffected])];
    await recalculateAggregates(client, allIds);
    console.log(`  ✓ Updated aggregates for ${allIds.length} establishments\n`);

    // 8. Commit
    await client.query('COMMIT');

    // 9. Print statistics
    console.log('═══════════════════════════════════════════════════════');
    console.log('   📊 Seed Statistics');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log(`  Users created/reused: ${users.length}`);
    console.log(`  Total reviews: ${stats.total}`);
    console.log(`  Partner responses: ${stats.withResponse} (${Math.round(stats.withResponse / stats.total * 100)}%)`);
    console.log(`  Establishments with reviews: ${stats.establishmentsWithReviews.size}/${establishments.length}`);
    console.log(`  Establishments with 0 reviews: ${establishments.length - stats.establishmentsWithReviews.size}`);
    console.log('');
    console.log('  Rating distribution:');
    for (let r = 5; r >= 1; r--) {
      const count = stats.byRating[r];
      const pct = Math.round(count / stats.total * 100);
      const bar = '█'.repeat(Math.round(pct / 2));
      console.log(`    ${r}★: ${String(count).padStart(3)} (${String(pct).padStart(2)}%) ${bar}`);
    }

    // Verify aggregates
    console.log('\n  Sample aggregates (top 5 by review count):');
    const topResult = await pool.query(
      `SELECT name, city, review_count, average_rating
       FROM establishments
       WHERE partner_id = $1 AND status = 'active'
       ORDER BY review_count DESC
       LIMIT 5`,
      [partnerId],
    );
    for (const row of topResult.rows) {
      console.log(`    ${row.name} (${row.city}): ${row.review_count} reviews, avg ${row.average_rating}`);
    }

    console.log('\n✅ Seed reviews completed successfully!\n');
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('\n❌ Seed process failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

seed().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
