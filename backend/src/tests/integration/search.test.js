/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Search & Discovery System Integration Tests
 *
 * Tests PostGIS geospatial queries and search functionality:
 * - Radius-based search (1km, 5km, 10km, 50km)
 * - Bounds-based search (map view)
 * - Distance calculations (haversine formula via PostGIS)
 * - Filtering (categories, cuisines, price range, rating)
 * - Combined filters (category + cuisine + distance + rating)
 * - Intelligent ranking (distance + rating + review_count + boost_score)
 * - Pagination
 * - Belarus coordinates validation
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

let partnerId;

// Default working hours for test establishments
const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' }
});

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await clearAllData();
  // Create partner for establishments
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, 'partner@test.com', 'hash', 'Partner', 'partner', 'email']
  );
});

afterAll(async () => {
  await clearAllData();
});

describe('Search System - Radius-Based Search', () => {
  beforeEach(async () => {
    // Seed establishments at known distances from Minsk center (53.9, 27.5)

    // Establishment 1: At Minsk center (0km)
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Центр Минска', gen_random_uuid()::text, 'В центре', 'Минск', 'Центр', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    // Establishment 2: 3km from center
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Близко', gen_random_uuid()::text, 'Рядом', 'Минск', 'Рядом', 53.92, 27.48, ARRAY['Кофейня'], ARRAY['Европейская'], 'active', $2::jsonb, '$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    // Establishment 3: 300km away (Gomel)
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Далеко', gen_random_uuid()::text, 'Гомель', 'Гомель', 'Далеко', 52.4, 31.0, ARRAY['Ресторан'], ARRAY['Народная'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);
  });

  test('should find establishments within 1km radius', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 1
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Центр Минска');
  });

  test('should find establishments within 5km radius', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 5
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(2);
    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toContain('Центр Минска');
    expect(names).toContain('Близко');
  });

  test('should find establishments within 500km radius', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 500
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(3);
  });

  test('should return empty array for search with no results', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 90.0, // North Pole
        longitude: 0.0,
        radius: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toEqual([]);
  });

  test('should include distance in response', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10
      })
      .expect(200);

    response.body.data.establishments.forEach(establishment => {
      expect(establishment.distance).toBeDefined();
      expect(typeof establishment.distance).toBe('number');
      expect(establishment.distance).toBeGreaterThanOrEqual(0);
    });
  });

  test('should order results by distance (closest first)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 500,
        sort_by: 'distance'
      })
      .expect(200);

    const distances = response.body.data.establishments.map(e => e.distance_km);

    // Check if sorted ascending
    for (let i = 0; i < distances.length - 1; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i + 1]);
    }
  });
});

describe('Search System - Filtering', () => {
  beforeEach(async () => {
    // Create diverse establishments for filtering tests
    const establishments = [
      { name: 'Ресторан 1', categories: ['Ресторан'], cuisines: ['Европейская'], price: '$$' },
      { name: 'Кофейня 1', categories: ['Кофейня'], cuisines: ['Европейская'], price: '$' },
      { name: 'Бар 1', categories: ['Бар'], cuisines: ['Американская'], price: '$$$' },
      { name: 'Ресторан Итальянский', categories: ['Ресторан'], cuisines: ['Итальянская'], price: '$$$$' },
      { name: 'Ресторан Японский', categories: ['Ресторан'], cuisines: ['Японская'], price: '$$$' }
    ];

    for (const est of establishments) {
      await query(`
        INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, 'Test', 'Минск', 'Test', 53.9, 27.5, $3, $4, $5, 'active', $6::jsonb, NOW(), NOW())
      `, [partnerId, est.name, est.categories, est.cuisines, est.price, defaultWorkingHours]);
    }
  });

  test('should filter by single category', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: 'Ресторан'
      })
      .expect(200);

    expect(response.body.data.establishments.length).toBe(3);
    response.body.data.establishments.forEach(est => {
      expect(est.categories).toContain('Ресторан');
    });
  });

  test('should filter by multiple categories', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: ['Ресторан', 'Кофейня']
      })
      .expect(200);

    expect(response.body.data.establishments.length).toBe(4);
  });

  test('should filter by single cuisine', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        cuisines: 'Итальянская'
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Ресторан Итальянский');
  });

  test('should filter by price range', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        priceRange: '$$$'
      })
      .expect(200);

    expect(response.body.data.establishments.length).toBe(2);
    response.body.data.establishments.forEach(est => {
      expect(est.price_range).toBe('$$$');
    });
  });

  test('should combine multiple filters', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: 'Ресторан',
        cuisines: 'Европейская',
        priceRange: '$$'
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Ресторан 1');
  });

  test('should return empty for filter with no matches', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        cuisines: 'Мексиканская' // Not in test data
      })
      .expect(200);

    expect(response.body.data.establishments).toEqual([]);
  });
});

describe('Search System - Pagination', () => {
  beforeEach(async () => {
    // Create 25 establishments for pagination testing
    for (let i = 1; i <= 25; i++) {
      await query(`
        INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $3::jsonb, '$$', NOW(), NOW())
      `, [partnerId, `Establishment ${i}`, defaultWorkingHours]);
    }
  });

  test('should paginate results (page 1)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        page: 1,
        limit: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(10);
    expect(response.body.data.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrevious: false
    });
  });

  test('should paginate results (page 2)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        page: 2,
        limit: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(10);
    expect(response.body.data.pagination).toMatchObject({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true
    });
  });

  test('should handle last page correctly', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        page: 3,
        limit: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(5); // Last 5 items
    expect(response.body.data.pagination).toMatchObject({
      page: 3,
      hasNext: false,
      hasPrevious: true
    });
  });
});

describe('Search System - Bounds-Based Search (Map View)', () => {
  test('should search within geographic bounds', async () => {
    // Create establishment in Minsk
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Minsk Center', gen_random_uuid()::text, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    const response = await request(app)
      .get('/api/v1/search/map')
      .query({
        neLat: 53.95,
        neLon: 27.6,
        swLat: 53.85,
        swLon: 27.4
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Minsk Center');
  });

  test('should exclude establishments outside bounds', async () => {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Outside Bounds', gen_random_uuid()::text, 'Test', 'Гомель', 'Test', 52.4, 31.0, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    const response = await request(app)
      .get('/api/v1/search/map')
      .query({
        neLat: 53.95,
        neLon: 27.6,
        swLat: 53.85,
        swLon: 27.4
      })
      .expect(200);

    expect(response.body.data.establishments).toEqual([]);
  });
});

describe('Search System - Validation', () => {
  test('should reject missing latitude', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        longitude: 27.5,
        radius: 5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject invalid radius (negative)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: -5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject invalid coordinates (out of range)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 200, // Invalid
        longitude: 27.5,
        radius: 5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// Advanced ranking and performance tests
// TODO: Requires implementing combined scoring in searchService (boost_score column exists but unused in queries)
describe('Search System - Intelligent Ranking', () => {
  test.todo('should rank by combined distance + rating + review_count');
  test.todo('should prioritize establishments with boost_score');
  test.todo('should handle establishments with no reviews (NULL rating)');
});

// TODO: Requires seeding 1000+ test establishments and EXPLAIN ANALYZE queries — deferred to performance phase
describe('Search System - Performance', () => {
  test.todo('should perform well with 1000+ establishments');
  test.todo('should use PostGIS indexes efficiently');
});

// Brief 1 fix-in-place — searchService now applies public projection. These
// assertions verify that partner-sensitive / admin-only fields previously
// leaked through e.* SELECT + LEFT JOIN users no longer reach mobile responses.
describe('Search System - Public Projection (fix-in-place, Brief 1)', () => {
  const SENSITIVE_FIELDS = [
    'partner_id',
    'partner_name',
    'partner_email',
    'subscription_tier',
    'subscription_started_at',
    'subscription_expires_at',
    'base_score',
    'boost_score',
    'is_seed',
    'claimed_at',
    'claimed_by',
    'moderation_notes',
    'moderated_by',
    'moderated_at',
  ];

  beforeEach(async () => {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, base_score, boost_score, subscription_tier, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Проекционный тест', gen_random_uuid()::text, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', 75, 5, 'premium', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);
  });

  test('/search/establishments (radius mode) — list excludes sensitive fields', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, radius: 5 })
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const est of response.body.data.establishments) {
      for (const field of SENSITIVE_FIELDS) {
        expect(est).not.toHaveProperty(field);
      }
    }
  });

  test('/search/establishments (no-location mode) — list excludes sensitive fields', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const est of response.body.data.establishments) {
      for (const field of SENSITIVE_FIELDS) {
        expect(est).not.toHaveProperty(field);
      }
    }
  });

  test('/search/establishments/:id — detail excludes sensitive fields', async () => {
    const list = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, radius: 5 });

    const id = list.body.data.establishments[0].id;

    const response = await request(app)
      .get(`/api/v1/search/establishments/${id}`)
      .expect(200);

    for (const field of SENSITIVE_FIELDS) {
      expect(response.body.data).not.toHaveProperty(field);
    }
  });

  test('/search/map — markers exclude sensitive fields', async () => {
    const response = await request(app)
      .get('/api/v1/search/map')
      .query({ neLat: 53.95, neLon: 27.6, swLat: 53.85, swLon: 27.4 })
      .expect(200);

    expect(response.body.data.establishments.length).toBeGreaterThan(0);
    for (const est of response.body.data.establishments) {
      for (const field of SENSITIVE_FIELDS) {
        expect(est).not.toHaveProperty(field);
      }
    }
  });

  test('projection preserves all public fields that mobile UI consumes', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, radius: 5 })
      .expect(200);

    const est = response.body.data.establishments[0];
    // Core fields mobile relies on
    expect(est).toHaveProperty('id');
    expect(est).toHaveProperty('name');
    expect(est).toHaveProperty('city');
    expect(est).toHaveProperty('address');
    expect(est).toHaveProperty('latitude');
    expect(est).toHaveProperty('longitude');
    expect(est).toHaveProperty('categories');
    expect(est).toHaveProperty('cuisines');
    expect(est).toHaveProperty('price_range');
    expect(est).toHaveProperty('average_rating');
    expect(est).toHaveProperty('review_count');
    expect(est).toHaveProperty('distance_km');
    // Mobile Dart model casts json['status'] as non-nullable String —
    // projection MUST preserve this neutral field even though the value
    // is always 'active' for public endpoints. Regression guard.
    expect(est).toHaveProperty('status');
    expect(est.status).toBe('active');
    // Derived public fields added by projection
    expect(est).toHaveProperty('city_slug');
    expect(est).toHaveProperty('category_slug');
    expect(est).toHaveProperty('has_promotion');
  });

  test('GET /search/establishments/:id detail preserves status field for mobile', async () => {
    const list = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, radius: 5 });

    const id = list.body.data.establishments[0].id;

    const response = await request(app)
      .get(`/api/v1/search/establishments/${id}`)
      .expect(200);

    expect(response.body.data).toHaveProperty('status');
    expect(response.body.data.status).toBe('active');
  });
});

describe('Search System - Могилёв: два написания одного города', () => {
  // Валидация принимает ОБА написания (VALID_CITIES несёт и «Могилев», и
  // «Могилёв»), поэтому в базе законно оказываются оба. Сравнение города в
  // поиске точное, и без разворота в набор вариантов клиент, приславший одно
  // написание, не увидел бы половину города. Отказ молчаливый: приложение
  // честно отвечает, что заведений нет.
  //
  // Публичный каталог это уже закрывал через expandCityForQuery; мобильный
  // путь (/search/establishments и /search/smart) шёл мимо.
  beforeEach(async () => {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Через Ё', gen_random_uuid()::text, 'ё', 'Могилёв', 'Ленинская 1', 53.91, 30.35, ARRAY['Ресторан'], ARRAY['Народная'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Через Е', gen_random_uuid()::text, 'е', 'Могилев', 'Ленинская 2', 53.92, 30.36, ARRAY['Ресторан'], ARRAY['Народная'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    // Соседний город: доказывает, что разворот не превратился в «показать всё».
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Не Могилёв', gen_random_uuid()::text, 'др', 'Минск', 'Минская 3', 53.90, 27.50, ARRAY['Ресторан'], ARRAY['Народная'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);
  });

  test('запрос через «ё» находит и карточку, записанную через «е»', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Могилёв' })
      .expect(200);

    // Множество, а не отсортированный список: `.sort()` в JS сравнивает коды
    // символов, и «Ё» (U+0401) встаёт перед «Е» (U+0415). Порядок выдачи тут
    // не предмет проверки — предмет в том, что найдены ОБА написания.
    const names = new Set(response.body.data.establishments.map((e) => e.name));
    expect(names).toEqual(new Set(['Через Е', 'Через Ё']));
  });

  test('запрос через «е» находит и карточку, записанную через «ё»', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Могилев' })
      .expect(200);

    // Множество, а не отсортированный список: `.sort()` в JS сравнивает коды
    // символов, и «Ё» (U+0401) встаёт перед «Е» (U+0415). Порядок выдачи тут
    // не предмет проверки — предмет в том, что найдены ОБА написания.
    const names = new Set(response.body.data.establishments.map((e) => e.name));
    expect(names).toEqual(new Set(['Через Е', 'Через Ё']));
  });

  test('разворот не расширяет выдачу на другие города', async () => {
    // Без этой проверки мутация «отдавать все города» прошла бы зелёной:
    // обе проверки выше смотрят только на то, что нужное НАЙДЕНО.
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Могилёв' })
      .expect(200);

    const names = response.body.data.establishments.map((e) => e.name);
    expect(names).not.toContain('Не Могилёв');
    expect(response.body.data.pagination.total).toBe(2);
  });

  test('обычный город разворотом не затронут', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const names = response.body.data.establishments.map((e) => e.name);
    expect(names).toEqual(['Не Могилёв']);
  });
});

describe('Search System - удобство: значение не true не роняет поиск и не считается отметкой', () => {
  // Кнопка удобства в mobile — `features` в /search/establishments. Фильтр
  // приводил значение ключа к boolean — `(attributes->>ключ)::boolean = true`, —
  // и первая же карточка со значением, которого Postgres не читает как boolean
  // («да», массив, объект, 2, пустая строка), роняла ВЕСЬ запрос: ошибка на
  // любом поиске с этим удобством у всех, а не выпадение одной карточки
  // (клиенту 400 INVALID_FORMAT — так обработчик переводит код Postgres 22P02;
  // в логе — ошибка уровня 500). Запись значения не проверяет (валидатор знает
  // только isObject).
  //
  // Отмечено = JSON true: так удобство рисуют все экраны карточки (web
  // `=== true`, mobile и admin-web `== true`), так записан канон AF1 (SDL
  // CAT-C-3.15: «true или ключа нет»). Любое другое значение — «не отмечено»,
  // без ошибки (решение Координатора 30.09.2026).
  //
  // Каждый тест проходит гео-дверь тремя запросами: координаты без города
  // (searchByRadius, фильтр радиуса), координаты с городом — так шлёт mobile
  // (searchByRadius, ветка города: у счёта другой срез параметров), город без
  // координат (searchWithoutLocation).
  const CARDS = [
    ['Терраса true', { terrace: true }],
    ['Терраса «да»', { terrace: 'да' }],
    ['Терраса массивом', { terrace: [1] }],
    ['Терраса объектом', { terrace: { value: true } }],
    ['Терраса числом 2', { terrace: 2 }],
    ['Терраса пустой строкой', { terrace: '' }],
    ['Терраса false', { terrace: false }],
    ['Терраса null', { terrace: null }],
    ['Без удобств', {}],
  ];

  async function insertCard(name, attributes) {
    await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, attributes, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', 'active', $3::jsonb, $4::jsonb, NOW(), NOW())
    `, [partnerId, name, defaultWorkingHours, JSON.stringify(attributes)]);
  }

  beforeEach(async () => {
    for (const [name, attributes] of CARDS) {
      await insertCard(name, attributes);
    }
  });

  /** Один фильтр удобств через три пути гео-двери: статус, имена, счёт. */
  async function searchGeoDoor(features) {
    const outcome = (response) => ({
      status: response.status,
      names: (response.body.data?.establishments ?? []).map((e) => e.name).sort(),
      total: response.body.data?.pagination?.total,
    });
    const byRadius = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, radius: 10, features });
    const byRadiusInCity = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, city: 'Минск', features });
    const byCity = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск', features });
    return {
      byRadius: outcome(byRadius),
      byRadiusInCity: outcome(byRadiusInCity),
      byCity: outcome(byCity),
    };
  }

  /** Одинаковый ожидаемый исход на всех трёх путях. */
  const onEveryPath = (expected) => ({ byRadius: expected, byRadiusInCity: expected, byCity: expected });

  test('«Терраса»: 200 и только карточка с true — «да», массив, объект, 2, пустая строка не роняют запрос', async () => {
    expect(await searchGeoDoor('terrace'))
      .toEqual(onEveryPath({ status: 200, names: ['Терраса true'], total: 1 }));
  });

  test('«yes», строка «true» и число 1 — не отметка: карточка их не рисует, фильтр не считает', async () => {
    // Postgres прочёл бы их как boolean true, и прежний код такие карточки
    // находил. Но экран карточки удобство при таком значении не рисует —
    // гость нашёл бы по «Терраса» карточку без террасы.
    //
    // Остаются только карточки, которые прежний код читал без ошибки: иначе на
    // старом коде тест падал бы на 400 от «да» и массива, а не на смысле.
    await query(`DELETE FROM establishments WHERE name NOT IN ('Терраса true', 'Терраса false', 'Терраса null', 'Без удобств')`);
    await insertCard('Терраса «yes»', { terrace: 'yes' });
    await insertCard('Терраса «true» строкой', { terrace: 'true' });
    await insertCard('Терраса числом 1', { terrace: 1 });

    expect(await searchGeoDoor('terrace'))
      .toEqual(onEveryPath({ status: 200, names: ['Терраса true'], total: 1 }));
  });

  test('ключ вне канона с массивом (так правка карточки кладёт `features`) — 200 и пусто', async () => {
    // Гео-дверь и умный поиск берут ключи удобств без белого списка, а
    // updateEstablishment складывает в `attributes.features` массив. Прежний
    // код отвечал на `features=features` ошибкой (клиенту 400).
    await query(`UPDATE establishments SET attributes = '{"features": ["Wi-Fi", "Парковка"]}'::jsonb WHERE name = 'Без удобств'`);

    expect(await searchGeoDoor('features'))
      .toEqual(onEveryPath({ status: 200, names: [], total: 0 }));
  });
});
