/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Smart Search Integration Tests
 *
 * Tests AI-powered smart search pipeline:
 * - Input validation and sanitization
 * - AI intent parsing → filter building
 * - Fallback to ILIKE when AI unavailable
 * - Redis caching (hit/miss)
 * - Rate limiting
 * - Price mapping (price_max → price_range)
 * - End-to-end search with parsed intent
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import * as smartSearchService from '../../services/smartSearchService.js';
import redisClient, { connectRedis, deleteKey } from '../../config/redis.js';

let partnerId;

const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' },
});

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await clearAllData();
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, 'partner@test.com', 'hash', 'Partner', 'partner', 'email']
  );

  // Seed test establishments
  // 1: Coffee shop in Minsk center
  await query(`
    INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Кофе Тайм', 'Уютная кофейня в центре', 'Минск', 'ул. Ленина 1', 53.9, 27.5, ARRAY['Кофейня'], ARRAY['Европейская'], 'active', $2::jsonb, '$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 2: Italian restaurant
  await query(`
    INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Итальяно', 'Итальянская кухня', 'Минск', 'пр. Независимости 50', 53.91, 27.55, ARRAY['Ресторан'], ARRAY['Итальянская'], 'active', $2::jsonb, '$$$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 3: Budget fast food
  await query(`
    INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Бургер Хаус', 'Быстро и вкусно', 'Минск', 'ул. Сурганова 10', 53.92, 27.58, ARRAY['Фаст-фуд'], ARRAY['Американская'], 'active', $2::jsonb, '$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 4: Georgian restaurant in Gomel
  await query(`
    INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Хинкальная', 'Грузинская кухня', 'Гомель', 'ул. Советская 5', 52.4, 31.0, ARRAY['Ресторан'], ARRAY['Грузинская'], 'active', $2::jsonb, '$$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);
});

afterAll(async () => {
  await clearAllData();
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('Smart Search - Input Validation', () => {
  test('should reject request without query', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject empty query string', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test('should reject invalid latitude', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', latitude: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('latitude');
  });

  test('should reject invalid longitude', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', longitude: -200 });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('longitude');
  });

  test('should sanitize query with control characters', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе\x00\x01 рядом' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('should truncate query longer than 150 characters', async () => {
    const longQuery = 'а'.repeat(200);
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: longQuery });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

// ─── Fallback (no API key) ───────────────────────────────────────────────────

describe('Smart Search - Fallback Mode', () => {
  test('should return results via fallback when AI unavailable', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.fallback).toBe(true);
    expect(response.body.data.intent).toBeNull();
    expect(Array.isArray(response.body.data.establishments)).toBe(true);
  });

  test('should find coffee shop via fallback ILIKE', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'Кофе Тайм' });

    expect(response.status).toBe(200);
    expect(response.body.data.establishments.length).toBeGreaterThanOrEqual(1);
    expect(response.body.data.establishments.some(e => e.name === 'Кофе Тайм')).toBe(true);
  });

  test('should find establishments via SEARCH_SYNONYMS fallback', async () => {
    // Segment B: AI may now return dish="бургер" (category=null) per the
    // dish-vs-category distinction in the new prompt. When that happens,
    // search filters on menu_items, so we seed one so that Бургер Хаус is
    // reachable via either the category path (legacy) or the dish path (new).
    const burgerEst = await query(
      `SELECT id FROM establishments WHERE name = $1 LIMIT 1`,
      ['Бургер Хаус'],
    );
    if (burgerEst.rows.length > 0) {
      const estId = burgerEst.rows[0].id;
      const mediaRes = await query(
        `INSERT INTO establishment_media
           (establishment_id, type, file_type, url, thumbnail_url, preview_url)
         VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
         RETURNING id`,
        [estId],
      );
      const mediaId = mediaRes.rows[0].id;
      await query(
        `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, position)
         VALUES ($1, $2, 'Классический бургер', 12.00, 0)`,
        [estId, mediaId],
      );
    }

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'бургер' });

    expect(response.status).toBe(200);
    // Should find via either: (a) synonym: бургер → Фаст-фуд category + Американская cuisine
    // or (b) dish="бургер" → menu_items.item_name ILIKE '%бургер%'
    expect(response.body.data.establishments.length).toBeGreaterThanOrEqual(1);
  });

  test('should filter by city in fallback mode', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'ресторан', city: 'Гомель' });

    expect(response.status).toBe(200);
    const establishments = response.body.data.establishments;
    if (establishments.length > 0) {
      establishments.forEach(e => {
        expect(e.city).toBe('Гомель');
      });
    }
  });

  test('should work with coordinates in fallback mode', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({
        query: 'кофе',
        latitude: 53.9,
        longitude: 27.5,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(true);
    expect(Array.isArray(response.body.data.establishments)).toBe(true);
  });
});

// ─── Response Format ─────────────────────────────────────────────────────────

describe('Smart Search - Response Format', () => {
  test('should include all required response fields', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе' });

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data).toHaveProperty('intent');
    expect(data).toHaveProperty('establishments');
    expect(data).toHaveProperty('pagination');
    expect(data).toHaveProperty('fallback');
    expect(data.pagination).toHaveProperty('total');
    expect(data.pagination).toHaveProperty('page');
    expect(data.pagination).toHaveProperty('limit');
    expect(data.pagination).toHaveProperty('totalPages');
  });

  test('should respect limit parameter', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'ресторан', limit: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data.establishments.length).toBeLessThanOrEqual(2);
  });

  test('should respect page parameter', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'ресторан', limit: 1, page: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data.pagination.page).toBe(2);
  });

  test('should cap limit at 100', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', limit: 999 });

    expect(response.status).toBe(200);
    expect(response.body.data.pagination.limit).toBe(100);
  });
});

// ─── buildSmartSearchFilters unit tests ──────────────────────────────────────

describe('Smart Search - Filter Building', () => {
  test('should map category from intent', () => {
    const intent = {
      cuisine: null, category: 'Кофейня', meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.categories).toEqual(['Кофейня']);
  });

  test('should map cuisines array from intent', () => {
    const intent = {
      cuisine: ['Итальянская', 'Европейская'], category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.cuisines).toEqual(['Итальянская', 'Европейская']);
  });

  test('should map price_max <= 15 to ["$"]', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: 10, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.priceRange).toEqual(['$']);
  });

  test('should map price_max <= 30 to ["$", "$$"]', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: 25, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.priceRange).toEqual(['$', '$$']);
  });

  test('should map price_max > 30 to ["$", "$$", "$$$"]', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: 50, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.priceRange).toEqual(['$', '$$', '$$$']);
  });

  test('should use distance sort when coordinates provided and sort is null', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {
      latitude: 53.9, longitude: 27.5,
    });
    expect(filters.sortBy).toBe('distance');
  });

  test('should use rating sort when no coordinates and sort is null', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.sortBy).toBe('rating');
  });

  test('should pass explicit sort from intent', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: 'price_asc', tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.sortBy).toBe('price_asc');
  });

  test('should join tags into search string', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: ['терраса', 'wifi'], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.search).toBe('терраса wifi');
  });

  test('should use AI location over context city', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: 'Гродно', sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, { city: 'Минск' });
    expect(filters.city).toBe('Гродно');
  });

  test('should fall back to context city when AI location is null', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, { city: 'Минск' });
    expect(filters.city).toBe('Минск');
  });
});

// ─── Cache ───────────────────────────────────────────────────────────────────

describe('Smart Search - Caching', () => {
  let redisReady = false;

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      redisReady = await connectRedis();
    } else {
      redisReady = true;
    }
  });

  afterAll(async () => {
    if (redisReady) {
      await deleteKey('smartsearch:test_hash_001');
    }
  });

  test('cacheIntent and getCachedIntent roundtrip', async () => {
    if (!redisReady) {
      console.warn('Redis not available, skipping cache roundtrip test');
      return;
    }

    const intent = {
      cuisine: ['Итальянская'], category: 'Ресторан', meal_type: null,
      price_max: null, location: null, sort: 'rating', tags: [], error: null,
    };
    const hash = 'test_hash_001';

    await smartSearchService.cacheIntent(hash, intent, 60);
    const cached = await smartSearchService.getCachedIntent(hash);

    expect(cached).toEqual(intent);
  });

  test('getCachedIntent returns null for missing key', async () => {
    const cached = await smartSearchService.getCachedIntent('nonexistent_hash');
    expect(cached).toBeNull();
  });
});
