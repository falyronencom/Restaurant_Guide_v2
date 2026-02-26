/**
 * Seed Script with Placeholder Images
 *
 * Creates 75 establishments with placeholder images from picsum.photos
 * No local files required - uses public placeholder image service.
 *
 * Usage:
 *   node backend/scripts/seed-establishments-placeholder.js        # Add to existing
 *   node backend/scripts/seed-establishments-placeholder.js --clean # Clean first
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import configuration modules
import { ESTABLISHMENT_CONFIGS, WORKING_HOURS_PATTERNS, generatePhotoCount } from './seed-data/establishments-config.js';
import {
  ESTABLISHMENT_NAMES,
  generateDescription,
  generateAddress,
  generateCoordinates,
  generatePhone,
} from './seed-data/content-templates.js';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

/**
 * Generate placeholder image URLs using picsum.photos
 * Each establishment gets unique images based on seed
 */
function generatePlaceholderImages(establishmentIndex, config) {
  const photoConfig = generatePhotoCount(config.photoCount);
  const { interiors: interiorCount, menus: menuCount } = photoConfig;

  const images = [];
  const baseSeed = establishmentIndex * 100;

  // Interior photos (wider aspect ratio)
  for (let i = 0; i < interiorCount; i++) {
    const seed = baseSeed + i;
    images.push({
      type: 'interior',
      url: `https://picsum.photos/seed/${seed}/1920/1080`,
      preview_url: `https://picsum.photos/seed/${seed}/800/600`,
      thumbnail_url: `https://picsum.photos/seed/${seed}/200/150`,
      position: i,
      is_primary: i === 0, // First interior is primary
    });
  }

  // Menu photos (square-ish for food)
  for (let i = 0; i < menuCount; i++) {
    const seed = baseSeed + 50 + i;
    images.push({
      type: 'menu',
      url: `https://picsum.photos/seed/${seed}/1200/1200`,
      preview_url: `https://picsum.photos/seed/${seed}/600/600`,
      thumbnail_url: `https://picsum.photos/seed/${seed}/200/200`,
      position: interiorCount + i,
      is_primary: false,
    });
  }

  return images;
}

/**
 * Get or create dedicated seed partner account
 */
async function getOrCreateSeedPartner(client) {
  const email = 'seed.data.generator@restaurantguide.by';

  const checkResult = await client.query('SELECT id FROM users WHERE email = $1', [email]);

  if (checkResult.rows.length > 0) {
    console.log('✓ Using existing seed partner account');
    return checkResult.rows[0].id;
  }

  const insertResult = await client.query(
    `INSERT INTO users (email, name, role, auth_method, email_verified, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [email, 'Seed Data Generator', 'partner', 'email', true, true]
  );

  console.log('✓ Created new seed partner account');
  return insertResult.rows[0].id;
}

/**
 * Delete all establishments owned by seed partner
 */
async function cleanSeedEstablishments(client, partnerId) {
  // First delete media for seed establishments
  await client.query(`
    DELETE FROM establishment_media
    WHERE establishment_id IN (SELECT id FROM establishments WHERE partner_id = $1)
  `, [partnerId]);

  // Then delete establishments
  const result = await client.query('DELETE FROM establishments WHERE partner_id = $1 RETURNING id', [partnerId]);
  console.log(`✓ Deleted ${result.rowCount} existing seed establishments`);
}

/**
 * Create establishment in database
 */
async function createEstablishment(client, partnerId, config, index) {
  const {
    city,
    categories,
    cuisines,
    price_range,
    nameIndex,
    descriptionLength,
    workingHoursPattern,
    attributes,
    status,
    isEdgeCase,
  } = config;

  const name = ESTABLISHMENT_NAMES[nameIndex] || `Заведение ${index + 1}`;
  const description = generateDescription(descriptionLength);
  const address = generateAddress(city);
  const coordinates = generateCoordinates(city);
  const phone = generatePhone();

  const hoursGenerator = WORKING_HOURS_PATTERNS[workingHoursPattern] || WORKING_HOURS_PATTERNS.restaurant;
  const working_hours = hoursGenerator();

  const query = `
    INSERT INTO establishments (
      partner_id,
      name,
      description,
      city,
      address,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories,
      cuisines,
      price_range,
      working_hours,
      attributes,
      status,
      subscription_tier,
      base_score,
      boost_score,
      view_count,
      favorite_count,
      review_count,
      average_rating
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
    RETURNING id, name, city, status
  `;

  const values = [
    partnerId,
    name,
    description,
    city,
    address,
    coordinates.latitude,
    coordinates.longitude,
    phone,
    null,
    null,
    categories,
    cuisines,
    price_range,
    JSON.stringify(working_hours),
    JSON.stringify(attributes),
    status,
    'free',
    0,
    0,
    Math.floor(Math.random() * 500), // Random view count 0-500
    Math.floor(Math.random() * 50),  // Random favorite count 0-50
    Math.floor(Math.random() * 30),  // Random review count 0-30
    (Math.random() * 2 + 3).toFixed(1), // Random rating 3.0-5.0
  ];

  const result = await client.query(query, values);
  const establishment = result.rows[0];

  const edgeCaseMarker = isEdgeCase ? ` [${isEdgeCase}]` : '';
  console.log(`  ✓ ${index + 1}/75: ${establishment.name} (${establishment.city})${edgeCaseMarker}`);

  return establishment;
}

/**
 * Add media records for establishment
 */
async function addEstablishmentMedia(client, establishmentId, config, index) {
  const images = generatePlaceholderImages(index, config);
  let primaryImageUrl = null;

  for (const image of images) {
    await client.query(
      `INSERT INTO establishment_media (establishment_id, type, url, thumbnail_url, preview_url, position, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [establishmentId, image.type, image.url, image.thumbnail_url, image.preview_url, image.position, image.is_primary]
    );

    if (image.is_primary) {
      primaryImageUrl = image.preview_url;
    }
  }

  // Set primary_image_url for search card thumbnails
  if (primaryImageUrl) {
    await client.query(
      'UPDATE establishments SET primary_image_url = $1 WHERE id = $2',
      [primaryImageUrl, establishmentId]
    );
  }

  return images.length;
}

/**
 * Validate seed data after creation
 */
async function validateSeedData(client) {
  console.log('\n📊 Validation Results:\n');

  // Total count
  const countResult = await client.query('SELECT COUNT(*) as total FROM establishments');
  console.log(`  Total establishments: ${countResult.rows[0].total}`);

  // By status
  const statusResult = await client.query(`
    SELECT status, COUNT(*) as count
    FROM establishments
    GROUP BY status
    ORDER BY count DESC
  `);
  console.log('\n  By status:');
  statusResult.rows.forEach((row) => {
    console.log(`    ${row.status}: ${row.count}`);
  });

  // Geographic distribution
  const cityResult = await client.query(`
    SELECT city, COUNT(*) as count
    FROM establishments
    GROUP BY city
    ORDER BY count DESC
  `);
  console.log('\n  Geographic distribution:');
  cityResult.rows.forEach((row) => {
    console.log(`    ${row.city}: ${row.count}`);
  });

  // Category coverage
  const categoryResult = await client.query(`
    SELECT unnest(categories) as category, COUNT(*) as count
    FROM establishments
    GROUP BY category
    ORDER BY count DESC
  `);
  console.log('\n  Category coverage:');
  categoryResult.rows.forEach((row) => {
    console.log(`    ${row.category}: ${row.count}`);
  });

  // Price range distribution
  const priceResult = await client.query(`
    SELECT price_range, COUNT(*) as count
    FROM establishments
    WHERE price_range IS NOT NULL
    GROUP BY price_range
    ORDER BY price_range
  `);
  console.log('\n  Price range distribution:');
  priceResult.rows.forEach((row) => {
    console.log(`    ${row.price_range}: ${row.count}`);
  });

  // Media count
  const mediaResult = await client.query('SELECT COUNT(*) as total FROM establishment_media');
  console.log(`\n  Total media records: ${mediaResult.rows[0].total}`);

  // Sample URL
  const sampleUrlResult = await client.query('SELECT url FROM establishment_media LIMIT 1');
  if (sampleUrlResult.rows.length > 0) {
    console.log(`\n  Sample image URL: ${sampleUrlResult.rows[0].url}`);
  }
}

/**
 * Main seed function
 */
async function seed() {
  const cleanMode = process.argv.includes('--clean');

  console.log('🌱 Restaurant Guide Belarus - Seed Data Generator (Placeholder Images)\n');
  console.log(`Mode: ${cleanMode ? 'CLEAN (delete existing seed data)' : 'ADDITIVE (preserve existing data)'}\n`);

  let client;

  try {
    client = await pool.connect();
    console.log('✓ Database connection established\n');

    // Begin transaction
    await client.query('BEGIN');

    // Get or create seed partner
    const partnerId = await getOrCreateSeedPartner(client);

    // Clean existing seed data if --clean flag
    if (cleanMode) {
      await cleanSeedEstablishments(client, partnerId);
    }

    console.log('');

    // Create establishments
    console.log(`🏪 Creating ${ESTABLISHMENT_CONFIGS.length} establishments:\n`);

    let totalMedia = 0;

    for (let i = 0; i < ESTABLISHMENT_CONFIGS.length; i++) {
      const config = ESTABLISHMENT_CONFIGS[i];

      try {
        const establishment = await createEstablishment(client, partnerId, config, i);
        const mediaCount = await addEstablishmentMedia(client, establishment.id, config, i);
        totalMedia += mediaCount;
      } catch (error) {
        console.error(`  ✗ Failed to create establishment ${i + 1}: ${error.message}`);
      }
    }

    console.log(`\n📸 Added ${totalMedia} media records with placeholder images`);

    // Validate results
    await validateSeedData(client);

    // Commit transaction
    await client.query('COMMIT');

    console.log('\n✅ Seed process completed successfully!\n');
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

// Execute
seed().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
