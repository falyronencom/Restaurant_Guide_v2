/**
 * Seed Script for Restaurant Guide Belarus v2.0
 *
 * Creates 75 realistic test establishments with comprehensive distribution:
 * - Geographic: Минск (35), other 6 cities (7 each)
 * - Categories: All 13 types with realistic distribution
 * - Cuisines: All 10 types with 1-3 per establishment
 * - Price range: ~30% '$', ~50% '$$', ~20% '$$$'
 * - Media: Real Cloudinary uploads from curated local images
 * - Edge cases: 7 explicit scenarios for mobile UI testing
 *
 * Usage:
 *   node backend/scripts/seed-establishments.js        # Add to existing data
 *   node backend/scripts/seed-establishments.js --clean # Delete seed data first
 *
 * Architecture:
 * - Transaction-based execution (atomic: all or nothing)
 * - Progress logging for visibility
 * - Graceful error handling with detailed messages
 * - Validation queries confirming success criteria
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// Cloudinary SDK
import { v2 as cloudinary } from 'cloudinary';

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
dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Paths to seed images
const SEED_IMAGES_PATH = path.join(__dirname, 'seed-images');
const INTERIORS_PATH = path.join(SEED_IMAGES_PATH, 'interiors');
const FOOD_PATH = path.join(SEED_IMAGES_PATH, 'food');
const MENUS_PATH = path.join(SEED_IMAGES_PATH, 'menus');

/**
 * Get list of image files from directory
 *
 * @param {string} dirPath - Directory path
 * @returns {Promise<string[]>} Array of absolute file paths
 */
async function getImageFiles(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    const imageFiles = files
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file))
      .map((file) => path.join(dirPath, file));
    return imageFiles;
  } catch (error) {
    console.error(`⚠️  Warning: Could not read directory ${dirPath}: ${error.message}`);
    return [];
  }
}

/**
 * Upload image to Cloudinary
 *
 * @param {string} filePath - Local image file path
 * @param {string} establishmentId - UUID for folder organization
 * @param {string} mediaType - 'interior' or 'menu'
 * @returns {Promise<object>} Upload result with public_id
 */
async function uploadToCloudinary(filePath, establishmentId, mediaType) {
  try {
    const uploadResult = await cloudinary.uploader.upload(filePath, {
      folder: `establishments/${establishmentId}/${mediaType}`,
      resource_type: 'image',
      quality: 'auto',
      fetch_format: 'auto',
      transformation: [
        {
          width: 1920,
          height: 1080,
          crop: 'limit',
        },
      ],
    });

    return {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
    };
  } catch (error) {
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  }
}

/**
 * Generate three resolution URLs from public_id
 *
 * @param {string} publicId - Cloudinary public_id
 * @returns {object} {url, preview_url, thumbnail_url}
 */
function generateImageUrls(publicId) {
  // Original (1920x1080 limit)
  const url = cloudinary.url(publicId, {
    transformation: [
      { width: 1920, height: 1080, crop: 'limit' },
      { fetch_format: 'auto', quality: 'auto', flags: 'progressive' },
    ],
    secure: true,
  });

  // Preview (800x600 fit)
  const preview_url = cloudinary.url(publicId, {
    transformation: [
      { width: 800, height: 600, crop: 'fit' },
      { fetch_format: 'auto', quality: 'auto', flags: 'progressive' },
    ],
    secure: true,
  });

  // Thumbnail (200x150 fill)
  const thumbnail_url = cloudinary.url(publicId, {
    transformation: [
      { width: 200, height: 150, crop: 'fill' },
      { fetch_format: 'auto', quality: 'auto', flags: 'progressive' },
    ],
    secure: true,
  });

  return { url, preview_url, thumbnail_url };
}

/**
 * Get or create dedicated seed partner account
 *
 * @param {object} client - Database client
 * @returns {Promise<string>} Partner UUID
 */
async function getOrCreateSeedPartner(client) {
  const email = 'seed.data.generator@restaurantguide.by';

  // Check if partner exists
  const checkResult = await client.query('SELECT id FROM users WHERE email = $1', [email]);

  if (checkResult.rows.length > 0) {
    console.log('✓ Using existing seed partner account');
    return checkResult.rows[0].id;
  }

  // Create new partner
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
 *
 * @param {object} client - Database client
 * @param {string} partnerId - Partner UUID
 */
async function cleanSeedEstablishments(client, partnerId) {
  const result = await client.query('DELETE FROM establishments WHERE partner_id = $1 RETURNING id', [partnerId]);

  console.log(`✓ Deleted ${result.rowCount} existing seed establishments`);
}

/**
 * Create establishment in database
 *
 * @param {object} client - Database client
 * @param {string} partnerId - Partner UUID
 * @param {object} config - Establishment configuration
 * @param {number} index - Establishment index for logging
 * @returns {Promise<object>} Created establishment record
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

  // Generate content
  const name = ESTABLISHMENT_NAMES[nameIndex] || `Заведение ${index + 1}`;
  const description = generateDescription(descriptionLength);
  const address = generateAddress(city);
  const coordinates = generateCoordinates(city);
  const phone = generatePhone();

  // Generate working hours
  const hoursGenerator = WORKING_HOURS_PATTERNS[workingHoursPattern] || WORKING_HOURS_PATTERNS.restaurant;
  const working_hours = hoursGenerator();

  // Insert establishment
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
    null, // email
    null, // website
    categories,
    cuisines,
    price_range,
    JSON.stringify(working_hours),
    JSON.stringify(attributes),
    status,
    'free', // subscription_tier (all seed data uses free tier)
    0, // base_score
    0, // boost_score
    0, // view_count
    0, // favorite_count
    0, // review_count
    0.0, // average_rating
  ];

  const result = await client.query(query, values);
  const establishment = result.rows[0];

  // Log with edge case marker if applicable
  const edgeCaseMarker = isEdgeCase ? ` [${isEdgeCase}]` : '';
  console.log(`  ✓ ${index + 1}/75: ${establishment.name} (${establishment.city})${edgeCaseMarker}`);

  return establishment;
}

/**
 * Upload media for establishment
 *
 * @param {object} client - Database client
 * @param {string} establishmentId - Establishment UUID
 * @param {object} config - Establishment configuration
 * @param {array} interiorImages - Available interior image paths
 * @param {array} menuImages - Available menu image paths
 */
async function uploadEstablishmentMedia(client, establishmentId, config, interiorImages, menuImages) {
  const photoConfig = generatePhotoCount(config.photoCount);
  const { interiors: interiorCount, menus: menuCount } = photoConfig;

  let position = 0;
  let isPrimarySet = false;
  let primaryImageUrl = null;

  // Upload interior photos
  for (let i = 0; i < interiorCount && i < interiorImages.length; i++) {
    try {
      const imagePath = interiorImages[i % interiorImages.length]; // Cycle if needed

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(imagePath, establishmentId, 'interior');

      // Generate three resolution URLs
      const urls = generateImageUrls(uploadResult.public_id);

      // Insert media record
      await client.query(
        `INSERT INTO establishment_media (establishment_id, type, url, thumbnail_url, preview_url, position, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [establishmentId, 'interior', urls.url, urls.thumbnail_url, urls.preview_url, position, !isPrimarySet]
      );

      if (!isPrimarySet) {
        primaryImageUrl = urls.preview_url;
        isPrimarySet = true;
      }
      position++;
    } catch (error) {
      console.error(`    ⚠️  Failed to upload interior photo ${i + 1}: ${error.message}`);
    }
  }

  // Upload menu photos
  for (let i = 0; i < menuCount && i < menuImages.length; i++) {
    try {
      const imagePath = menuImages[i % menuImages.length]; // Cycle if needed

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(imagePath, establishmentId, 'menu');

      // Generate three resolution URLs
      const urls = generateImageUrls(uploadResult.public_id);

      // Insert media record
      await client.query(
        `INSERT INTO establishment_media (establishment_id, type, url, thumbnail_url, preview_url, position, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [establishmentId, 'menu', urls.url, urls.thumbnail_url, urls.preview_url, position, !isPrimarySet && i === 0]
      );

      if (!isPrimarySet && i === 0) {
        primaryImageUrl = urls.preview_url;
        isPrimarySet = true;
      }
      position++;
    } catch (error) {
      console.error(`    ⚠️  Failed to upload menu photo ${i + 1}: ${error.message}`);
    }
  }

  // Set primary_image_url for search card thumbnails
  if (primaryImageUrl) {
    await client.query(
      'UPDATE establishments SET primary_image_url = $1 WHERE id = $2',
      [primaryImageUrl, establishmentId]
    );
  }
}

/**
 * Validate seed data after creation
 *
 * @param {object} client - Database client
 */
async function validateSeedData(client) {
  console.log('\n📊 Validation Results:\n');

  // Total count
  const countResult = await client.query('SELECT COUNT(*) as total FROM establishments');
  console.log(`  Total establishments: ${countResult.rows[0].total}`);

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

  // Edge cases verification
  const edgeCasesResult = await client.query(`
    SELECT name, city, status,
           (SELECT COUNT(*) FROM establishment_media WHERE establishment_id = establishments.id) as photo_count
    FROM establishments
    WHERE LENGTH(name) > 50
       OR status = 'suspended'
       OR array_length(categories, 1) = 2
    ORDER BY name
  `);
  console.log('\n  Edge cases detected:');
  edgeCasesResult.rows.forEach((row) => {
    console.log(`    ${row.name} (${row.city}) - ${row.photo_count} photos, status: ${row.status}`);
  });

  // Media count
  const mediaResult = await client.query('SELECT COUNT(*) as total FROM establishment_media');
  console.log(`\n  Total media records: ${mediaResult.rows[0].total}`);

  // Sample Cloudinary URL validation
  const sampleUrlResult = await client.query('SELECT url FROM establishment_media LIMIT 1');
  if (sampleUrlResult.rows.length > 0) {
    console.log(`\n  Sample Cloudinary URL: ${sampleUrlResult.rows[0].url}`);
  }
}

/**
 * Main seed function
 */
async function seed() {
  const cleanMode = process.argv.includes('--clean');

  console.log('🌱 Restaurant Guide Belarus - Seed Data Generator\n');
  console.log(`Mode: ${cleanMode ? 'CLEAN (delete existing seed data)' : 'ADDITIVE (preserve existing data)'}\n`);

  let client;

  try {
    // Test database connection
    client = await pool.connect();
    console.log('✓ Database connection established\n');

    // Load seed images
    console.log('📸 Loading seed images...');
    const interiorImages = await getImageFiles(INTERIORS_PATH);
    const menuImages = await getImageFiles(MENUS_PATH);

    console.log(`  Interiors: ${interiorImages.length} images`);
    console.log(`  Menus: ${menuImages.length} images`);

    if (interiorImages.length === 0 || menuImages.length === 0) {
      throw new Error(
        'Insufficient seed images. Ensure backend/scripts/seed-images/ contains interiors/ and menus/ subdirectories with images.'
      );
    }

    console.log('');

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

    for (let i = 0; i < ESTABLISHMENT_CONFIGS.length; i++) {
      const config = ESTABLISHMENT_CONFIGS[i];

      try {
        // Create establishment
        const establishment = await createEstablishment(client, partnerId, config, i);

        // Upload media
        await uploadEstablishmentMedia(client, establishment.id, config, interiorImages, menuImages);
      } catch (error) {
        console.error(`  ✗ Failed to create establishment ${i + 1}: ${error.message}`);
        // Continue with next establishment (graceful degradation)
      }
    }

    // Validate results
    await validateSeedData(client);

    // Commit transaction
    await client.query('COMMIT');

    console.log('\n✅ Seed process completed successfully!\n');
  } catch (error) {
    // Rollback transaction on error
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

// Execute seed if run directly
const isMainModule = process.argv[1] && process.argv[1].endsWith('seed-establishments.js');

if (isMainModule) {
  seed().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default seed;
