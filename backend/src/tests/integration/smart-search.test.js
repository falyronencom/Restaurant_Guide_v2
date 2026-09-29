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

import crypto from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import * as smartSearchService from '../../services/smartSearchService.js';
import redisClient, { connectRedis, deleteKey } from '../../config/redis.js';

let partnerId;

// Unique-per-file fixture to prevent collision with other test files
// that use testUsers.partner (email='partner@test.com').
const PARTNER_EMAIL = `partner-smartsearch-${Date.now()}@test.com`;
const PARTNER_PHONE = `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' },
});

/**
 * Лимитеры считают запросы в Redis по IP, а под supertest он один на весь файл.
 * `/search/smart` пускает 30 запросов в минуту (ratelimit:smart_search:*), и с
 * подключённым Redis включается общий лимит 300 в час (ratelimit:ip:*). После
 * подключения Redis (блок Caching) файл делает больше 30 запросов, а прогоны
 * подряд в один час копят общий счётчик — без чистки середина файла ловит 429
 * вместо проверок. Как в promotions.test.js и auth-password-reset.test.js.
 */
async function clearRateLimitKeys() {
  if (!redisClient.isOpen) return;
  for (const pattern of ['ratelimit:smart_search:*', 'ratelimit:ip:*']) {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
}

beforeAll(async () => {
  const partner = await createUserAndGetTokens({
    ...testUsers.partner,
    email: PARTNER_EMAIL,
    phone: PARTNER_PHONE,
  });
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await clearAllData();
  await clearRateLimitKeys();
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, PARTNER_EMAIL, 'hash', 'Partner', 'partner', 'email']
  );

  // Seed test establishments
  // 1: Coffee shop in Minsk center
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Кофе Тайм', gen_random_uuid()::text, 'Уютная кофейня в центре', 'Минск', 'ул. Ленина 1', 53.9, 27.5, ARRAY['Кофейня'], ARRAY['Европейская'], 'active', $2::jsonb, '$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 2: Italian restaurant
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Итальяно', gen_random_uuid()::text, 'Итальянская кухня', 'Минск', 'пр. Независимости 50', 53.91, 27.55, ARRAY['Ресторан'], ARRAY['Итальянская'], 'active', $2::jsonb, '$$$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 3: Budget fast food
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Бургер Хаус', gen_random_uuid()::text, 'Быстро и вкусно', 'Минск', 'ул. Сурганова 10', 53.92, 27.58, ARRAY['Фаст-фуд'], ARRAY['Американская'], 'active', $2::jsonb, '$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 4: Georgian restaurant in Gomel
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Хинкальная', gen_random_uuid()::text, 'Грузинская кухня', 'Гомель', 'ул. Советская 5', 52.4, 31.0, ARRAY['Ресторан'], ARRAY['Грузинская'], 'active', $2::jsonb, '$$', NOW(), NOW())
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

  test('should turn amenity tags into the amenity filter, not a search string', () => {
    // Until 29.09.2026 the tags were joined into a card-text ILIKE — zero rows on
    // prod for every tag phrase (see «Smart Search - удобства из фразы» below).
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: ['терраса', 'wifi'], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.features).toEqual(['wifi', 'terrace']);
    expect(filters.search).toBeUndefined();
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

    // Падать честно, а не зеленеть молча: без Redis в этом блоке проверять
    // нечего. Та же позиция, что в reviews / promotions / auth-password-reset.
    if (!redisReady) {
      throw new Error('Redis connection is required for the intent cache test');
    }
  });

  afterAll(async () => {
    if (redisReady) {
      await deleteKey('smartsearch:test_hash_001');
    }
  });

  test('cacheIntent and getCachedIntent roundtrip', async () => {
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

// ─── Dish path: AI intent replayed from the Redis cache ──────────────────────
//
// Prod defect 07.09.2026 (20 Minsk establishments with parsed menus):
// POST /search/smart «пицца» → intent {dish:"пицца", tags:["пицца"]} → total 0,
// while GET /search/establishments?search=пицца found 2 (SEARCH_SYNONYMS).
// Two causes: (1) tags became an establishment-level ILIKE AND-ed with the
// menu_items EXISTS; (2) the EXISTS matched item_name only — pizzas are named
// «Маргарита», the menu section (category_raw) is «Пицца».
//
// OpenRouter is unavailable in tests, so the AI path is reached the way prod
// reaches it on a cache hit: the parsed intent is seeded under the key
// executeSmartSearch derives (smartsearch:<sha256(normalized query)[0..32)>).
// Redis is a hard requirement here (local redis-test, CI service): a missing
// Redis must fail these tests, not skip them.

function intentCacheHash(queryText) {
  // Mirrors normalizeQuery() + generateQueryHash() in smartSearchService.js
  const normalized = queryText.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function dishIntent(dish, extra = {}) {
  return {
    cuisine: null, category: null, dish, meal_type: null, price_max: null,
    location: null, sort: null, tags: [dish], error: null, ...extra,
  };
}

describe('Smart Search - Dish path (intent replayed from cache)', () => {
  const seededHashes = new Set();

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    for (const hash of seededHashes) {
      await deleteKey(`smartsearch:${hash}`).catch(() => {});
    }
  });

  beforeEach(async () => {
    // 5: plain café — no synonym; name/description/categories/cuisines carry
    // neither «пицц» nor «капучино». Only its parsed menu can match.
    const est = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Тестовое кафе', gen_random_uuid()::text, 'Обычное кафе без подсказок в описании', 'Минск', 'ул. Тестовая 7', 53.93, 27.6, ARRAY['Кафе'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours]);
    const estId = est.rows[0].id;
    const media = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/menu.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [estId],
    );
    const mediaId = media.rows[0].id;
    await query(
      `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, position)
       VALUES ($1, $2, 'Маргарита', 18.00, 'Пицца', FALSE, 0),
              ($1, $2, 'Пепперони', 12.00, 'Пицца', TRUE, 1),
              ($1, $2, 'КАПУЧИНО', 6.50, 'Напитки', FALSE, 2)`,
      [estId, mediaId],
    );
  });

  async function seedIntent(queryText, intent) {
    expect(redisClient.isOpen).toBe(true);
    const hash = intentCacheHash(queryText);
    seededHashes.add(hash);
    await smartSearchService.cacheIntent(hash, intent, 60);
    // Prove the seed landed — otherwise the request would silently take the
    // fallback path and the assertions below would test the wrong thing.
    expect(await smartSearchService.getCachedIntent(hash)).toEqual(intent);
  }

  test('environment guard: ILIKE folds Cyrillic case in the test database', async () => {
    const r = await query(`SELECT 'КАПУЧИНО' ILIKE '%капучино%' AS folded`);
    expect(r.rows[0].folded).toBe(true);
  });

  test('«пицца»: menu section «Пицца» (category_raw) finds the café; synonyms keep the Italian place — and nothing else', async () => {
    await seedIntent('пицца', dishIntent('пицца'));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.intent.dish).toBe('пицца');
    const names = response.body.data.establishments.map(e => e.name).sort();
    expect(names).toEqual(['Итальяно', 'Тестовое кафе']);
    expect(response.body.data.pagination.total).toBe(2);
  });

  test('«капучино»: a dish outside SEARCH_SYNONYMS is found through item_name (case-insensitive) — tags no longer AND-filter the establishment', async () => {
    await seedIntent('капучино', dishIntent('капучино'));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'капучино', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toEqual(['Тестовое кафе']);
  });

  test('«пицца до 20 рублей»: budget is checked against the menu (Маргарита 18 ≤ 20); unverified synonym matches are excluded', async () => {
    await seedIntent('пицца до 20 рублей', dishIntent('пицца', { price_max: 20 }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца до 20 рублей', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.intent.price_max).toBe(20);
    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toEqual(['Тестовое кафе']);
  });

  test('«пицца до 15 рублей»: over-budget (18) and admin-hidden (12) items do not count; no synonym fallback under a budget → empty', async () => {
    await seedIntent('пицца до 15 рублей', dishIntent('пицца', { price_max: 15 }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца до 15 рублей', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.establishments).toEqual([]);
    expect(response.body.data.pagination.total).toBe(0);
  });
});
// --- Фильтры экрана на умном эндпоинте --------------------------------------
//
// Решение 07.09.2026: строка поиска на mobile всегда ходит сюда, значит экран
// результатов присылает вместе с фразой свои фильтры, сортировку и страницу.
// Ниже — что с ними происходит на живой базе: intent сеется в Redis (OpenRouter
// в тестах недоступен), затем запрос идёт через настоящий контроллер и SQL.

describe('Smart Search - фильтры экрана в теле запроса', () => {
  const seededHashes = new Set();

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    for (const hash of seededHashes) {
      await deleteKey(`smartsearch:${hash}`).catch(() => {});
    }
  });

  async function seedIntent(queryText, intent) {
    expect(redisClient.isOpen).toBe(true);
    const hash = intentCacheHash(queryText);
    seededHashes.add(hash);
    await smartSearchService.cacheIntent(hash, intent, 60);
    // Доказать, что посев лёг: иначе запрос ушёл бы на ветку fallback и
    // проверки ниже мерили бы совсем другой путь.
    expect(await smartSearchService.getCachedIntent(hash)).toEqual(intent);
  }

  function plainIntent(extra = {}) {
    return {
      cuisine: null, category: null, dish: null, meal_type: null, price_max: null,
      location: null, sort: null, tags: [], error: null, ...extra,
    };
  }

  test('явный ярус цены сужает выдачу умного поиска', async () => {
    await seedIntent('поесть', plainIntent());

    const all = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'поесть', city: 'Минск' });

    expect(all.status).toBe(200);
    expect(all.body.data.fallback).toBe(false);
    expect(all.body.data.establishments.map(e => e.name).sort())
      .toEqual(['Бургер Хаус', 'Итальяно', 'Кофе Тайм']);

    const narrowed = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'поесть', city: 'Минск', priceRange: ['$$$'] });

    expect(narrowed.status).toBe(200);
    expect(narrowed.body.data.establishments.map(e => e.name)).toEqual(['Итальяно']);
    expect(narrowed.body.data.pagination.total).toBe(1);
  });

  test('явный ярус побеждает ярус, выведенный из «до 10 рублей»', async () => {
    // price_max без блюда подставляет ['$'] — это дало бы Бургер Хаус и Кофе
    // Тайм. Карточка '$$$' с экрана оставляет только Итальяно.
    await seedIntent('поесть до 10 рублей', plainIntent({ price_max: 10 }));

    const inferred = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'поесть до 10 рублей', city: 'Минск' });

    expect(inferred.body.data.establishments.map(e => e.name).sort())
      .toEqual(['Бургер Хаус', 'Кофе Тайм']);

    const explicit = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'поесть до 10 рублей', city: 'Минск', priceRange: ['$$$'] });

    expect(explicit.body.data.establishments.map(e => e.name)).toEqual(['Итальяно']);
  });

  test('явная сортировка применяется к выдаче', async () => {
    await seedIntent('поесть в минске', plainIntent({ sort: 'rating' }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'поесть в минске', city: 'Минск', sort_by: 'price_desc' });

    expect(response.status).toBe(200);
    // '$$$' Итальяно впереди двух '$'; порядок внутри яруса — по имени.
    expect(response.body.data.establishments.map(e => e.name))
      .toEqual(['Итальяно', 'Бургер Хаус', 'Кофе Тайм']);
  });

  test('страница 2 отдаёт следующую карточку и честную пагинацию', async () => {
    await seedIntent('минские места', plainIntent());

    const first = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'минские места', city: 'Минск', limit: 1, page: 1 });
    const second = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'минские места', city: 'Минск', limit: 1, page: 2 });

    expect(first.body.data.pagination)
      .toMatchObject({ page: 1, limit: 1, total: 3, totalPages: 3, hasNext: true, hasPrevious: false });
    expect(second.body.data.pagination)
      .toMatchObject({ page: 2, limit: 1, total: 3, totalPages: 3, hasNext: true, hasPrevious: true });
    expect(second.body.data.establishments).toHaveLength(1);
    expect(second.body.data.establishments[0].id)
      .not.toBe(first.body.data.establishments[0].id);
  });

  test('фильтры не входят в ключ кэша: один посев обслуживает разные фильтры', async () => {
    // Стоимостная модель CAT-C-2.2 держится на этом: переключение фильтров с
    // той же фразой — попадание в кэш, один SQL, без обращения к AI.
    await seedIntent('кэш-проверка', plainIntent());

    const a = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кэш-проверка', city: 'Минск', priceRange: ['$'] });
    const b = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кэш-проверка', city: 'Минск', priceRange: ['$$$'] });

    expect(a.body.data.fallback).toBe(false);
    expect(b.body.data.fallback).toBe(false);
    expect(a.body.data.establishments.map(e => e.name).sort())
      .toEqual(['Бургер Хаус', 'Кофе Тайм']);
    expect(b.body.data.establishments.map(e => e.name)).toEqual(['Итальяно']);
  });

  test('негодный hours_filter — 422 в конверте errorHandler', async () => {
    // Ошибка ФИЛЬТРА: её бросает общий парсер и оформляет errorHandler,
    // поэтому код тот же, что у GET /search/establishments, а не 400 проверок
    // тела. Конверт при этом ДРУГОЙ, чем у 400: errorHandler кладёт текст в
    // body.message, а внутри error оставляет только code. Клиент, который
    // читает error.message, на этом пути получит undefined — этот тест держит
    // форму, чтобы разница не открылась на устройстве. / The 422 envelope is
    // the errorHandler's: message at top level, error carries only the code.
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца', city: 'Минск', hours_filter: 'bogus' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toContain('until_22');
    expect(response.body.error.message).toBeUndefined();
  });

  test('пустой query остаётся 400 в конверте контроллера, даже когда фильтры негодны', async () => {
    // Порядок проверок: тело сначала. Иначе пользователь с пустой строкой
    // получал бы жалобу на фильтр вместо жалобы на запрос.
    // И встречная половина предыдущего теста: 400 пишет сам контроллер, там
    // текст лежит ВНУТРИ error.
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: '   ', hours_filter: 'bogus' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('query');
  });

  test('при отказе AI фильтры экрана всё равно применяются', async () => {
    // Без посева intent OpenRouter недоступен → ветка fallback. Она обязана
    // вести себя как классический эндпоинт С фильтрами: иначе отключение AI
    // молча РАСШИРЯЕТ выдачу вместо того, чтобы её сузить.
    const wide = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', city: 'Минск' });

    expect(wide.body.data.fallback).toBe(true);
    expect(wide.body.data.establishments.map(e => e.name)).toEqual(['Кофе Тайм']);

    const filtered = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', city: 'Минск', priceRange: ['$$$'] });

    expect(filtered.body.data.fallback).toBe(true);
    expect(filtered.body.data.establishments).toEqual([]);
    expect(filtered.body.data.pagination.total).toBe(0);
  });
});

// --- Разводка разбора (А1, 24.09.2026) --------------------------------------
//
// Разборы прежнего промпта живут в кэше до часа после выкатки, поэтому здесь
// сеется именно их форма: без dish_variants, «Рядом со мной» в location, кухня,
// додуманная к блюду. Нормализация при чтении из кэша обязана их исправить.
// Фикстура — европейское кафе с разделами «ЗАВТРАКИ» и «СУШИ» в меню: ни тип,
// ни кухня, ни описание этих слов не содержат — найти его можно только по меню.

describe('Smart Search - разводка разбора (А1)', () => {
  const seededHashes = new Set();

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    for (const hash of seededHashes) {
      await deleteKey(`smartsearch:${hash}`).catch(() => {});
    }
  });

  beforeEach(async () => {
    const est = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Утреннее кафе', gen_random_uuid()::text, 'Кафе у парка', 'Минск', 'ул. Парковая 3', 53.93, 27.6, ARRAY['Кафе'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours]);
    const estId = est.rows[0].id;
    const media = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/morning.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [estId],
    );
    await query(
      `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, position)
       VALUES ($1, $2, 'Сырники со сметаной', 9.00, 'ЗАВТРАКИ', FALSE, 0),
              ($1, $2, 'Филадельфия', 24.00, 'СУШИ', FALSE, 1)`,
      [estId, media.rows[0].id],
    );
  });

  async function seedIntent(queryText, intent) {
    expect(redisClient.isOpen).toBe(true);
    const hash = intentCacheHash(queryText);
    seededHashes.add(hash);
    await smartSearchService.cacheIntent(hash, intent, 60);
    // Посев обязан лечь, иначе запрос уйдёт на запасной путь и проверки ниже
    // будут мерить не тот путь.
    expect(await smartSearchService.getCachedIntent(hash)).toEqual(intent);
  }

  /** Форма разбора прежнего промпта — без dish_variants. */
  function oldPromptIntent(extra = {}) {
    return {
      cuisine: null, category: null, dish: null, meal_type: null, price_max: null,
      location: null, sort: null, tags: [], error: null, ...extra,
    };
  }

  test('«Рядом со мной» в location — не город: выдача по городу контекста, intent отдаёт сортировку по расстоянию', async () => {
    // Прод 24.09: фраза становилась фильтром города — 0 заведений из 26.
    await seedIntent('рядом со мной', oldPromptIntent({ location: 'Рядом со мной' }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'Рядом со мной', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.establishments.map(e => e.name).sort())
      .toEqual(['Бургер Хаус', 'Итальяно', 'Кофе Тайм', 'Утреннее кафе']);
    expect(response.body.data.intent.location).toBeNull();
    expect(response.body.data.intent.sort).toBe('distance');
  });

  test('«Завтрак» — приём пищи ищется в меню словом «завтрак» и находит раздел «ЗАВТРАКИ»', async () => {
    // Прежний промпт клал «завтрак» ещё и в теги — как фильтр карточки тег
    // обнулял выдачу, а сам meal_type отбрасывался (прод 24.09: 0).
    await seedIntent('завтрак', oldPromptIntent({ meal_type: 'breakfast', tags: ['завтрак'] }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'Завтрак', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.establishments.map(e => e.name)).toEqual(['Утреннее кафе']);
  });

  test('«Суши» с кухней, додуманной прежним промптом, — кухня не режет: суши в меню европейского кафе найдены', async () => {
    // Прод 24.09: «Суши» → cuisine «Японская» по И с меню — 1 заведение из 5.
    await seedIntent('суши', oldPromptIntent({ dish: 'суши', cuisine: ['Японская'], tags: ['суши'] }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'Суши', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.establishments.map(e => e.name)).toEqual(['Утреннее кафе']);
  });

  test('ответ несёт поля intent, которые читает mobile, и добавочное dish_variants', async () => {
    await seedIntent('роллы', {
      category: null, cuisine: null, dish: 'ролл', dish_variants: ['суши', 'sushi'], meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    });

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'роллы', city: 'Минск' });

    expect(response.status).toBe(200);
    const { intent } = response.body.data;
    // SmartSearchIntent.fromJson (mobile/lib/services/smart_search_service.dart)
    // читает ровно эти ключи; пропавший ключ там молча станет null.
    for (const key of ['category', 'cuisine', 'dish', 'meal_type', 'price_max', 'location', 'sort', 'tags']) {
      expect(intent).toHaveProperty(key);
    }
    expect(intent.dish).toBe('ролл');
    expect(intent.dish_variants).toEqual(['суши', 'sushi']);
  });

  test('разбор чужой формы в кэше — промах кэша, а не выдача всего города', async () => {
    // Без модели (в тестах её нет) промах кэша уходит на запасной путь.
    await seedIntent('битый кэш', { dish: 'суши' });

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'битый кэш', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(true);
    expect(response.body.data.intent).toBeNull();
  });
});

// --- Сопоставление с меню по словам (А2, 27.09.2026) -------------------------
//
// Буквальный ILIKE по фразе находил 79,1 % пар «запрос × заведение» на копии
// меню прода: «лосось» не находил «лосося», «драники» — «Дранікі», «суши» —
// ролл-бар. Умный поиск теперь сопоставляет по словам (dishMatch: 'lenient'):
// основа слова с начала слова, нечёткое совпадение от 0,65, ё/і/ў, варианты
// названия от модели как ИЛИ. Синонимы карточки остались только заведениям без
// видимого меню. Разборы сеются в Redis под ключ кэша (модели в тестах нет).
//
// У каждой фикстуры своя ловушка: «Котлета из лосятины» начинается с той же
// основы «лос», что даёт стеммер для «лосось»; «Лимонно-медовая заправка»
// похожа на «лимонад» на 0,625 — ниже порога; «Зелёный салат» и «Чай чёрный»
// несут оба слова «зелёного чая», но в разных позициях.

describe('Smart Search - сопоставление с меню по словам (А2)', () => {
  const seededHashes = new Set();

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    for (const hash of seededHashes) {
      await deleteKey(`smartsearch:${hash}`).catch(() => {});
    }
  });

  async function establishmentWithMenu(name, categories, cuisines, description, items) {
    const est = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $3, gen_random_uuid()::text, $6, 'Минск', 'ул. Тестовая 9', 53.93, 27.6, $4::varchar[], $5::varchar[], 'active', $2::jsonb, '$$', NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours, name, categories, cuisines, description]);
    const estId = est.rows[0].id;
    const media = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/a2.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [estId],
    );
    for (const [position, [itemName, section, price, hidden = false]] of items.entries()) {
      await query(
        `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [estId, media.rows[0].id, itemName, price, section, hidden, position],
      );
    }
  }

  beforeEach(async () => {
    await establishmentWithMenu('Рыбный дом', ['Ресторан'], ['Европейская'], 'Ресторан у реки', [
      ['Стейк из лосося', 'ГОРЯЧЕЕ', 35.00],
      ['Салат с курицей', 'САЛАТЫ', 16.00],
      ['Гребешки с соусом', 'ГОРЯЧЕЕ', 42.00],
      ['Чай зелёный', 'НАПИТКИ', 5.00],
      ['Тирамису', 'ДЕСЕРТЫ', 12.00],
      ['Устрицы Фин де Клер', 'ЗАКУСКИ', 30.00, true],
    ]);
    await establishmentWithMenu('Охотничий двор', ['Ресторан'], ['Европейская'], 'Дичь и соленья', [
      ['Котлета из лосятины', 'ГОРЯЧЕЕ', 28.00],
      ['Салат с уткой', 'САЛАТЫ', 17.00],
      ['Лимонно-медовая заправка', 'СОУСЫ', 3.00],
      ['Зелёный салат', 'САЛАТЫ', 11.00],
      ['Чай чёрный', 'НАПИТКИ', 4.00],
      ['Морс барбарисовый', 'НАПИТКИ', 4.50],
      ['Дранікі са смятанай', 'СТРАВЫ З БУЛЬБЫ', 14.00],
    ]);
    await establishmentWithMenu('Ролл-бар', ['Кафе'], ['Европейская'], 'Кафе на углу', [
      ['Ролл Филадельфия', 'РОЛЛЫ', 24.00],
      ['Устрицы Жилардо', 'ЗАКУСКИ', 9.00],
      ['Рис с овощами', 'ГАРНИРЫ', 6.00],
    ]);
    // Итальянский ресторан с распознанным меню, где пасты нет: синонимы
    // карточки («паста» → Ресторан/Итальянская) его больше не приводят.
    await establishmentWithMenu('Траттория Уно', ['Ресторан'], ['Итальянская'], 'Итальянский ресторан', [
      ['Капучино', 'НАПИТКИ', 6.00],
    ]);
    // Меню есть, но все позиции скрыты модератором — для выдачи это «без меню».
    await establishmentWithMenu('Закрытая кухня', ['Ресторан'], ['Итальянская'], 'Итальянский ресторан', [
      ['Капучино', 'НАПИТКИ', 6.00, true],
    ]);
    // Меню загружено, но ещё не распознано: файл есть, позиций нет — тоже «без меню».
    await establishmentWithMenu('Остерия', ['Ресторан'], ['Итальянская'], 'Итальянский ресторан', []);
  });

  async function seedIntent(queryText, intent) {
    expect(redisClient.isOpen).toBe(true);
    const hash = intentCacheHash(queryText);
    seededHashes.add(hash);
    await smartSearchService.cacheIntent(hash, intent, 60);
    // Посев обязан лечь, иначе запрос уйдёт на запасной путь и проверки ниже
    // будут мерить не тот путь.
    expect(await smartSearchService.getCachedIntent(hash)).toEqual(intent);
  }

  /** Разбор в форме промпта P1 (А1): блюдо, его варианты, остальное пусто. */
  function p1Intent(dish, extra = {}) {
    return {
      category: null, cuisine: null, dish, dish_variants: [], meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null, ...extra,
    };
  }

  /** Умный поиск по засеянному разбору → имена заведений по алфавиту. */
  async function smartNames(queryText, intent) {
    await seedIntent(queryText, intent);
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: queryText, city: 'Минск' });
    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    const names = response.body.data.establishments.map(e => e.name).sort();
    expect(response.body.data.pagination.total).toBe(names.length);
    return names;
  }

  test('словоформа по основе: «утка» находит «Салат с уткой», «курица» — «Салат с курицей»', async () => {
    // «утка» короче пяти букв — нечёткое совпадение её не спасает, «уткой»
    // находит только основа «утк». «курица» ~ «курицей» ещё и похожи (0,714).
    expect(await smartNames('утка', p1Intent('утка'))).toEqual(['Охотничий двор']);
    expect(await smartNames('курица', p1Intent('курица'))).toEqual(['Рыбный дом']);
  });

  test('основа не короче четырёх букв: «лосось» находит «Стейк из лосося», но не «Котлету из лосятины»', async () => {
    // Стеммер режет «лосось» до «лос» — с него начинается и «лосятина».
    expect(await smartNames('лосось', p1Intent('лосось'))).toEqual(['Рыбный дом']);
  });

  test('нечёткое совпадение от 0,65: опечатка и беглая гласная находятся, «лимонно-» для «лимонада» — нет', async () => {
    // «тирамиссу» ~ «Тирамису» 0,727; «гребешок» ~ «Гребешки» 0,667;
    // «лимонад» ~ «Лимонно-медовая заправка» 0,625.
    expect(await smartNames('тирамиссу', p1Intent('тирамиссу'))).toEqual(['Рыбный дом']);
    expect(await smartNames('гребешок', p1Intent('гребешок'))).toEqual(['Рыбный дом']);
    expect(await smartNames('лимонад', p1Intent('лимонад'))).toEqual([]);
  });

  test('варианты от модели — ИЛИ: «суши» с вариантом «ролл» находят ролл-бар, без варианта — нет', async () => {
    expect(await smartNames('суши', p1Intent('суши', { dish_variants: ['ролл'] }))).toEqual(['Ролл-бар']);
    expect(await smartNames('просто суши', p1Intent('суши'))).toEqual([]);
  });

  test('два слова — в одной позиции, в любом порядке, «ё» = «е»: «зеленый чай» находит «Чай зелёный», а не «Зелёный салат» + «Чай чёрный»', async () => {
    expect(await smartNames('зеленый чай', p1Intent('зеленый чай'))).toEqual(['Рыбный дом']);
  });

  test('белорусское «і»: «драники» находят «Дранікі са смятанай»', async () => {
    expect(await smartNames('драники', p1Intent('драники'))).toEqual(['Охотничий двор']);
  });

  test('синонимы карточки — только у заведений без видимого меню: «паста» не приводит рестораны, в чьём меню пасты нет', async () => {
    // «Остерия» — меню загружено, но не распознано (позиций нет); «Закрытая
    // кухня» — все позиции скрыты; «Итальяно» — без меню из общего beforeEach
    // файла. «Траттория Уно» (меню без пасты), «Рыбный дом» и «Охотничий двор»
    // (тоже рестораны) судятся по меню.
    expect(await smartNames('паста', p1Intent('паста'))).toEqual(['Закрытая кухня', 'Итальяно', 'Остерия']);
  });

  test('бюджет проверяется на совпавшей позиции: «лосось до 30 рублей» — пусто (35 BYN), «до 40» — находит', async () => {
    expect(await smartNames('лосось до 30 рублей', p1Intent('лосось', { price_max: 30 }))).toEqual([]);
    expect(await smartNames('лосось до 40 рублей', p1Intent('лосось', { price_max: 40 }))).toEqual(['Рыбный дом']);
  });

  test('скрытая модератором позиция не находится и при сопоставлении по словам', async () => {
    // «Устрицы Фин де Клер» в «Рыбном доме» скрыты, «Устрицы Жилардо» — нет.
    expect(await smartNames('устрицы', p1Intent('устрицы'))).toEqual(['Ролл-бар']);
  });

  test('начало слова, а не середина: «рис» находит «Рис с овощами», но не «Морс барбарисовый»', async () => {
    expect(await smartNames('рис', p1Intent('рис'))).toEqual(['Ролл-бар']);
  });

  test('одиночный dish вне умного поиска остаётся строгим: «лосось» — подстрокой, по словам — только явным dishMatch', async () => {
    const { searchWithoutLocation } = await import('../../services/searchService.js');

    const strict = await searchWithoutLocation({ dish: 'лосось', city: 'Минск' });
    const lenient = await searchWithoutLocation({ dish: 'лосось', city: 'Минск', dishMatch: 'lenient' });

    expect(strict.establishments.map(e => e.name)).toEqual([]);
    expect(lenient.establishments.map(e => e.name)).toEqual(['Рыбный дом']);
  });
});

// --- Поиск заведения по названию (решение Координатора 29.09.2026) -----------
//
// Прод 29.09: с промпта P1 (24.09) название не доходило до поиска — «Tiden»
// давал весь город, «urban dzen cafe» (разбор «Кафе») — чужую карточку,
// «андердог» (разбор «блюдо») — ноль. Теперь фраза сверяется с названиями в
// базе. Разборы сеются в кэш Redis в той форме, какую давал прод, — модель в
// тестах недоступна. Каждая фикстура несёт ловушку для прежнего кода: у
// «Итальяно» рейтинг выше, чем у underdog, «Ромашка» — единственное кафе.

describe('Smart Search - поиск по названию заведения', () => {
  const seededHashes = new Set();

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    for (const hash of seededHashes) {
      await deleteKey(`smartsearch:${hash}`).catch(() => {});
    }
  });

  async function establishment(name, categories, cuisines, city = 'Минск') {
    const est = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $3, gen_random_uuid()::text, 'Описание без подсказок', $6, 'ул. Тестовая 11', 53.9, 27.56, $4::varchar[], $5::varchar[], 'active', $2::jsonb, '$$', NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours, name, categories, cuisines, city]);
    return est.rows[0].id;
  }

  beforeEach(async () => {
    await establishment('TIDEN', ['Кофейня'], ['Вегетарианская']);
    await establishment('urban dzen cafe', ['Кофейня'], ['Авторская']);
    await establishment('Ромашка', ['Кафе'], ['Европейская']);
    await establishment('SFB Minsk', ['Бар'], ['Смешанная']);
    // Заведение, названное общим словом: на «бар» — первым, но бары остаются.
    await establishment('Бар', ['Бар'], ['Европейская']);
    // underdog — пиццерия с распознанным меню: пицца есть в разделе «Пицца».
    const underdogId = await establishment('underdog', ['Пиццерия'], ['Итальянская']);
    const media = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/underdog.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [underdogId],
    );
    await query(
      `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, position)
       VALUES ($1, $2, 'Маргарита', 21.00, 'Пицца', FALSE, 0)`,
      [underdogId, media.rows[0].id],
    );
    // «Итальяно» (общий beforeEach файла, без меню, пиццу даёт синоним) —
    // с высоким рейтингом: по обычной сортировке он выше underdog.
    await query(`UPDATE establishments SET average_rating = 5.0, review_count = 20 WHERE name = 'Итальяно'`);
  });

  async function seedIntent(queryText, intent) {
    expect(redisClient.isOpen).toBe(true);
    const hash = intentCacheHash(queryText);
    seededHashes.add(hash);
    await smartSearchService.cacheIntent(hash, intent, 60);
    // Посев обязан лечь, иначе запрос уйдёт на запасной путь.
    expect(await smartSearchService.getCachedIntent(hash)).toEqual(intent);
  }

  /** Разбор в форме промпта P1; пустой — как прод отвечал на названия 29.09. */
  function p1Intent(extra = {}) {
    return {
      category: null, cuisine: null, dish: null, dish_variants: [], meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null, ...extra,
    };
  }

  async function smart(queryText, intent, body = {}) {
    if (intent) await seedIntent(queryText, intent);
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: queryText, city: 'Минск', ...body });
    expect(response.status).toBe(200);
    return response.body.data;
  }

  const namesOf = (data) => data.establishments.map(e => e.name);

  /** Активные заведения Минска в этом блоке: 3 из общего beforeEach + 6 здесь. */
  const MINSK_TOTAL = 9;

  test('название как есть: «Tiden» при пустом разборе — одна карточка TIDEN, а не весь город', async () => {
    const data = await smart('Tiden', p1Intent());

    expect(data.fallback).toBe(false);
    expect(namesOf(data)).toEqual(['TIDEN']);
    expect(data.pagination.total).toBe(1);
    expect(data.pagination.totalPages).toBe(1);
  });

  test('другое письмо: «Тиден» находит TIDEN', async () => {
    const data = await smart('Тиден', p1Intent());

    expect(namesOf(data)).toEqual(['TIDEN']);
  });

  test('название, в котором модель увидела тип: «urban dzen cafe» — эта кофейня, а не кафе «Ромашка»; догадка «Кафе» из ответа убрана', async () => {
    const data = await smart('urban dzen cafe', p1Intent({ category: 'Кафе' }));

    expect(namesOf(data)).toEqual(['urban dzen cafe']);
    expect(data.pagination.total).toBe(1);
    // Заголовок превью mobile не должен писать «Кафе» над кофейней.
    expect(data.intent.category).toBeNull();
  });

  test('название и блюдо: «underdog пицца» — underdog первым, дальше остальная пицца, хотя по рейтингу «Итальяно» выше', async () => {
    const data = await smart('underdog пицца', p1Intent({ dish: 'пицца', dish_variants: ['pizza'] }));

    expect(namesOf(data)).toEqual(['underdog', 'Итальяно']);
    expect(data.pagination.total).toBe(2);
    // Разбор применён ко всей выдаче после underdog — в ответе он целиком.
    expect(data.intent.dish).toBe('пицца');
  });

  test('страницы при «первыми»: underdog на первой, «Итальяно» на второй, без повторов, total один на обеих', async () => {
    await seedIntent('underdog пицца', p1Intent({ dish: 'пицца' }));

    const page = async (n) => (await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'underdog пицца', city: 'Минск', limit: 1, page: n })).body.data;

    const first = await page(1);
    const second = await page(2);
    const third = await page(3);

    expect(namesOf(first)).toEqual(['underdog']);
    expect(namesOf(second)).toEqual(['Итальяно']);
    expect(namesOf(third)).toEqual([]);
    for (const data of [first, second, third]) {
      expect(data.pagination.total).toBe(2);
      expect(data.pagination.totalPages).toBe(2);
    }
    expect(first.pagination.hasNext).toBe(true);
    expect(second.pagination.hasNext).toBe(false);
  });

  test('модель приняла название за блюдо: «андердог» — в меню его нет, выдача не пустая, а underdog', async () => {
    const data = await smart('андердог', p1Intent({ dish: 'андердог' }));

    expect(namesOf(data)).toEqual(['underdog']);
    expect(data.intent.dish).toBeNull();
  });

  test('модель недоступна: «Тиден» на запасном пути находит TIDEN (ILIKE по сырой фразе его не видит)', async () => {
    // Тест выше посеял разбор этой фразы — без удаления запрос взял бы его из кэша.
    await deleteKey(`smartsearch:${intentCacheHash('Тиден')}`);
    expect(await smartSearchService.getCachedIntent(intentCacheHash('Тиден'))).toBeNull();

    const data = await smart('Тиден', null);

    expect(data.fallback).toBe(true);
    expect(data.intent).toBeNull();
    expect(namesOf(data)).toEqual(['TIDEN']);
  });

  test('слово-тип не превращается в поиск по названию: «кафе» — кафе «Ромашка», urban dzen cafe не поднимается', async () => {
    const data = await smart('кафе', p1Intent({ category: 'Кафе' }));

    expect(namesOf(data)).toEqual(['Ромашка']);
  });

  test('город во фразе — не название: «минск» — весь город, а не одна SFB Minsk', async () => {
    const data = await smart('минск', p1Intent({ location: 'Минск' }));

    expect(data.pagination.total).toBe(MINSK_TOTAL);
  });

  test('заведение с общим словом в названии: «бар» — «Бар» первым, SFB Minsk (тоже бар) остаётся', async () => {
    const data = await smart('бар', p1Intent({ category: 'Бар' }));

    expect(namesOf(data)).toEqual(['Бар', 'SFB Minsk']);
  });

  test('фильтры экрана действуют и на совпадение по названию: «Tiden» с фильтром «Кафе» — TIDEN (кофейня) не показывается', async () => {
    const data = await smart('Tiden', p1Intent(), { categories: ['Кафе'] });

    expect(namesOf(data)).toEqual(['Ромашка']);
  });

  test('выбранный город действует: «Tiden» в Гомеле — TIDEN (Минск) не показывается', async () => {
    const data = await smart('Tiden', p1Intent(), { city: 'Гомель' });

    expect(namesOf(data)).toEqual(['Хинкальная']);
  });

  test('без города и без выбранного расстояния — вся страна: «Tiden» из Гомеля (≈ 300 км) находится, скрытые 10 км не режут', async () => {
    // Город не прислан, есть только координаты: обычная выдача ограничена
    // 10 км вокруг человека, а названное заведение ищется везде.
    const data = await smart('Tiden', p1Intent(), { city: undefined, latitude: 52.4, longitude: 31.0 });

    expect(namesOf(data)).toEqual(['TIDEN']);
  });

  test('слово обстановки рядом с названием: «уютный Tiden» — одна TIDEN, а не TIDEN и следом весь город', async () => {
    // С 29.09.2026 «уютное» в тегах выдачу не режет (блок «удобства из фразы»
    // ниже), поэтому и «просит ещё что-то» оно не значит: режим — только
    // совпавшие, как у «Tiden».
    const data = await smart('уютный Tiden', p1Intent({ tags: ['уютное'] }));

    expect(namesOf(data)).toEqual(['TIDEN']);
    expect(data.pagination.total).toBe(1);
  });

  test('название и удобство: «Tiden с террасой» — TIDEN первым (удобство фразы к нему не применяется), дальше только места с террасой', async () => {
    // Терраса отмечена только у «Ромашки»: остальные 7 заведений Минска в
    // этом блоке без неё и в выдачу не попадают. TIDEN террасы не отмечал, но
    // названное заведение показывается — как с фильтром-догадкой «Кафе».
    await query(`UPDATE establishments SET attributes = '{"terrace": true}'::jsonb WHERE name = 'Ромашка'`);

    const data = await smart('Tiden с террасой', p1Intent({ tags: ['терраса'] }));

    expect(namesOf(data)).toEqual(['TIDEN', 'Ромашка']);
    expect(data.pagination.total).toBe(2);
  });

  test('расплывчатая фраза без совпадения названий — как прежде, весь город', async () => {
    const data = await smart('что-нибудь вкусное', p1Intent());

    expect(data.pagination.total).toBe(MINSK_TOTAL);
  });
});

// --- Удобства из фразы (29.09.2026) ------------------------------------------
//
// Прод 29.09: слово, которое разбор кладёт в tags, искалось текстом карточки по
// И — «с террасой», «живая музыка», «уютное место» давали ноль заведений при
// террасе у 19 карточек из 26: описаний нет ни у одной, удобства лежат в
// attributes. Теперь удобство из фразы — фильтр по attributes, как кнопка
// экрана (и при блюде тоже), а прочие слова тегов не фильтруют. Разборы сеются
// в Redis под ключ кэша (модели в тестах нет).
//
// Ловушка прежнего пути: описание «Кофе Тайм» — «Уютная кофейня в центре», но
// ILIKE '%уютное%' не находил даже его — словоформа другая.

describe('Smart Search - удобства из фразы', () => {
  const seededHashes = new Set();

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    for (const hash of seededHashes) {
      await deleteKey(`smartsearch:${hash}`).catch(() => {});
    }
  });

  beforeEach(async () => {
    // Удобства заведений общего beforeEach: терраса и Wi-Fi у кофейни, терраса
    // и доставка у итальянского ресторана, доставка у бургерной.
    await query(`UPDATE establishments SET attributes = '{"terrace": true, "wifi": true}'::jsonb WHERE name = 'Кофе Тайм'`);
    await query(`UPDATE establishments SET attributes = '{"terrace": true, "delivery": true}'::jsonb WHERE name = 'Итальяно'`);
    await query(`UPDATE establishments SET attributes = '{"delivery": true}'::jsonb WHERE name = 'Бургер Хаус'`);

    // Кафе без удобств, с пиццей в меню: «пицца» находит его по меню, а
    // «Итальяно» (меню нет) — синонимом карточки.
    const est = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Кафе у дома', gen_random_uuid()::text, 'Обычное кафе', 'Минск', 'ул. Садовая 4', 53.94, 27.61, ARRAY['Кафе'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours]);
    const media = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/home.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [est.rows[0].id],
    );
    await query(
      `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, position)
       VALUES ($1, $2, 'Маргарита', 17.00, 'Пицца', FALSE, 0)`,
      [est.rows[0].id, media.rows[0].id],
    );
  });

  async function seedIntent(queryText, intent) {
    expect(redisClient.isOpen).toBe(true);
    const hash = intentCacheHash(queryText);
    seededHashes.add(hash);
    await smartSearchService.cacheIntent(hash, intent, 60);
    // Посев обязан лечь, иначе запрос уйдёт на запасной путь и проверки ниже
    // будут мерить не тот путь.
    expect(await smartSearchService.getCachedIntent(hash)).toEqual(intent);
  }

  /** Разбор в форме промпта P1: теги — как их кладёт модель на проде 29.09. */
  function p1Intent(extra = {}) {
    return {
      category: null, cuisine: null, dish: null, dish_variants: [], meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null, ...extra,
    };
  }

  /** Умный поиск по засеянному разбору → имена заведений по алфавиту. */
  async function smartNames(queryText, intent, screenFilters = {}) {
    await seedIntent(queryText, intent);
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: queryText, city: 'Минск', ...screenFilters });
    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    const names = response.body.data.establishments.map(e => e.name).sort();
    expect(response.body.data.pagination.total).toBe(names.length);
    return names;
  }

  test('«с террасой» — заведения с террасой, а не ноль', async () => {
    expect(await smartNames('с террасой', p1Intent({ tags: ['терраса'] })))
      .toEqual(['Итальяно', 'Кофе Тайм']);
  });

  test('«уютное место» — слово обстановки не режет: весь город', async () => {
    expect(await smartNames('уютное место', p1Intent({ tags: ['уютное'] })))
      .toEqual(['Бургер Хаус', 'Итальяно', 'Кафе у дома', 'Кофе Тайм']);
  });

  test('удобство из фразы и кнопка экрана — по И: терраса и Wi-Fi только у кофейни', async () => {
    expect(await smartNames('летняя веранда', p1Intent({ tags: ['терраса'] }), { features: ['wifi'] }))
      .toEqual(['Кофе Тайм']);
  });

  test('«пицца с доставкой» — пиццерии с доставкой: кафе с пиццей без доставки уходит', async () => {
    expect(await smartNames('пицца', p1Intent({ dish: 'пицца' })))
      .toEqual(['Итальяно', 'Кафе у дома']);
    expect(await smartNames('пицца с доставкой', p1Intent({ dish: 'пицца', tags: ['доставка'] })))
      .toEqual(['Итальяно']);
  });

  test('«детская комната» — честный ноль: детскую зону не отметило ни одно заведение', async () => {
    // Удобство понято, данных нет — выдача пуста, как у кнопки «Детская зона»,
    // а не весь город, будто зона есть у всех.
    expect(await smartNames('детская комната', p1Intent({ tags: ['детская комната'] }))).toEqual([]);
  });
});
