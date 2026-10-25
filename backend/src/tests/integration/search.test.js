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
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';
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
});

describe('Search System - сортировка по рейтингу: заведение, у которого сняли последний отзыв, не встаёт первым', () => {
  // Пересчёт после снятия отзыва писал average_rating = AVG(...) по видимым
  // отзывам; когда их не осталось, AVG по пустому набору — NULL. Взвешенный
  // рейтинг с NULL тоже NULL, а при DESC Postgres ставит NULL ПЕРВЫМ — карточка
  // вставала в начало выдачи «по рейтингу» (на сайте — первой в «Популярном» на
  // главной). Снять последний отзыв может автор, скрыть или удалить — модератор.
  //
  // Порядок строят buildOrderByClause (поиск приложения тремя путями, умный
  // поиск, каталог и карта сайта без рамки) и свой ORDER BY у searchByBounds
  // (карта приложения, карта сайта с рамкой) — поэтому все двери.
  //
  // Все карточки в одной точке и в одном ярусе цены: расстояние и цена у всех
  // равны, и порядок решает взвешенный рейтинг — в любой сортировке.
  // Взвешенный: Любимая 4,54 > Хорошая 3,97 > «с одним отзывом 5» 3,75 >
  // без отзывов 3,5 > Слабая 2,83. Две карточки без отзывов делят 3,5 и идут
  // по имени: «Без отзывов» раньше «Отзыв сняли».
  const TARGET = 'Отзыв сняли';
  const CARDS = [
    // [имя, average_rating, review_count]
    ['Любимая', 4.8, 20],
    ['Хорошая', 4.2, 10],
    [TARGET, 0, 0],
    ['Без отзывов', 0, 0],
    ['Слабая', 2.5, 10],
  ];
  const AFTER_REMOVAL = [
    ['Любимая', 4.8, 20],
    ['Хорошая', 4.2, 10],
    ['Без отзывов', 0, 0],
    [TARGET, 0, 0],
    ['Слабая', 2.5, 10],
  ];
  const REVIEW_TEXT = 'Отзыв для проверки сортировки: длиннее двадцати символов.';

  let targetId;
  let reviewerToken;
  let adminToken;

  beforeEach(async () => {
    for (const [name, rating, reviews] of CARDS) {
      const inserted = await query(`
        INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, average_rating, review_count, status, working_hours, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, 'Тестовое место', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$', $3, $4, 'active', $5::jsonb, NOW(), NOW())
        RETURNING id
      `, [partnerId, name, rating, reviews, defaultWorkingHours]);
      if (name === TARGET) targetId = inserted.rows[0].id;
    }
    // Верхний beforeEach чистит users — автор и модератор каждый раз новые.
    reviewerToken = (await createUserAndGetTokens(testUsers.regularUser)).accessToken;
    adminToken = (await createAdminAndGetToken()).accessToken;
  });

  /**
   * Выдача «по рейтингу» через все двери: [имя, average_rating, review_count].
   * Карты сортировки не принимают — у них порядок всегда «по рейтингу», и он
   * решает, кто попадёт под предел числа маркеров.
   */
  async function rowsOnEveryDoor(sortBy) {
    const rows = (response) => {
      expect(response.status).toBe(200);
      return response.body.data.establishments
        .map((e) => [e.name, e.average_rating, e.review_count]);
    };
    const bounds = { neLat: 53.95, neLon: 27.6, swLat: 53.85, swLon: 27.4 };
    const doors = {
      byRadius: rows(await request(app)
        .get('/api/v1/search/establishments')
        .query({ latitude: 53.9, longitude: 27.5, radius: 10, sort_by: sortBy })),
      byRadiusInCity: rows(await request(app)
        .get('/api/v1/search/establishments')
        .query({ latitude: 53.9, longitude: 27.5, city: 'Минск', sort_by: sortBy })),
      byCity: rows(await request(app)
        .get('/api/v1/search/establishments')
        .query({ city: 'Минск', sort_by: sortBy })),
      publicCatalog: rows(await request(app)
        .get('/api/v1/public/establishments')
        .query({ city: 'minsk', sort_by: sortBy })),
      // OpenRouter в тестах выключен — запасной путь по фразе, та же сортировка.
      smart: rows(await request(app)
        .post('/api/v1/search/smart')
        .send({ query: 'место', city: 'Минск', sort_by: sortBy })),
      smartNearby: rows(await request(app)
        .post('/api/v1/search/smart')
        .send({ query: 'место', latitude: 53.9, longitude: 27.5, sort_by: sortBy })),
    };
    if (sortBy === 'rating') {
      doors.appMap = rows(await request(app).get('/api/v1/search/map').query(bounds));
      doors.siteMap = rows(await request(app).get('/api/v1/public/establishments/map').query(bounds));
      doors.siteMapByCity = rows(await request(app)
        .get('/api/v1/public/establishments/map')
        .query({ city: 'minsk' }));
    }
    return doors;
  }

  const onEveryDoor = (doors, expected) => Object.fromEntries(
    Object.keys(doors).map((door) => [door, expected]),
  );

  const REMOVALS = [
    ['автор удалил отзыв', (reviewId) => request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${reviewerToken}`)],
    ['модератор скрыл отзыв', (reviewId) => request(app)
      .post(`/api/v1/admin/reviews/${reviewId}/visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_visible: false })],
    ['модератор удалил отзыв', (reviewId) => request(app)
      .post(`/api/v1/admin/reviews/${reviewId}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'проверка сортировки' })],
  ];

  test.each(REMOVALS)('%s — карточка встаёт к заведениям без отзывов, а не первой', async (_label, removeReview) => {
    const created = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ establishmentId: targetId, rating: 5, content: REVIEW_TEXT });
    expect(created.status).toBe(201);

    // Отзыв лёг настоящим путём: пересчёт поднял карточку на третье место.
    const withReview = await request(app)
      .get('/api/v1/public/establishments')
      .query({ city: 'minsk', sort_by: 'rating' });
    expect(withReview.body.data.establishments.map((e) => [e.name, e.average_rating, e.review_count]))
      .toEqual([['Любимая', 4.8, 20], ['Хорошая', 4.2, 10], [TARGET, 5, 1], ['Без отзывов', 0, 0], ['Слабая', 2.5, 10]]);

    const removed = await removeReview(created.body.data.review.id);
    expect(removed.status).toBe(200);

    // Не первой, а там же, где заведение без отзывов, — и с тем же рейтингом 0:
    // «отзывы сняли» и «отзывов не было» для гостя одно и то же.
    const doors = await rowsOnEveryDoor('rating');
    expect(doors).toEqual(onEveryDoor(doors, AFTER_REMOVAL));
  });

  test('строка с пустым рейтингом (так её оставлял прежний пересчёт) не первая ни в одной сортировке', async () => {
    // Пересчёт отзывов NULL больше не пишет, но строка с NULL могла остаться от
    // прежнего: у скрытой или снятой с публикации карточки её не видно через
    // публичный API, а после возврата в выдачу она встала бы первой. Сортировка
    // считает пустой рейтинг априорной оценкой — как у заведения без отзывов.
    await query('UPDATE establishments SET average_rating = NULL, review_count = 0 WHERE id = $1', [targetId]);
    const expected = AFTER_REMOVAL.map((row) => (row[0] === TARGET ? [TARGET, null, 0] : row));

    // Цена и расстояние у всех равны: и в «по цене», и в «по расстоянию»
    // порядок решает тот же взвешенный рейтинг в тай-брейкере.
    for (const sortBy of ['rating', 'price_asc', 'price_desc', 'distance']) {
      const doors = await rowsOnEveryDoor(sortBy);
      expect({ sortBy, doors }).toEqual({ sortBy, doors: onEveryDoor(doors, expected) });
    }
  });
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

describe('Search System - сортировка по цене: карточки без цены — в конце при обоих направлениях', () => {
  // Стратегия §2.4: заведения без цены уходят в конец и при «сначала дешевле»,
  // и при «сначала дороже». Прежде цена переводилась в число через
  // `CASE … ELSE 5`: при ASC пятёрка стояла в конце, а при DESC 5 > 4 — и
  // карточка без цены вставала ПЕРВОЙ, выше '$$$$'. «Сначала дороже» зовут и
  // сайт (каталог), и mobile (обе поисковые ручки).
  //
  // Порядок строит одна buildOrderByClause, но SQL у дверей разный: координаты
  // без города — CTE с заменой алиаса `e.` → `ne.`; координаты с городом — так
  // шлёт mobile; город без координат — searchWithoutLocation, через него же
  // идёт публичный каталог сайта. /search/map по цене не сортирует вовсе.
  //
  // Все карточки в одной точке: расстояние на гео-путях у всех одно, и порядок
  // решает цена, а внутри яруса — прежний тай-брейкер, взвешенный рейтинг.
  // У «хвалёной» без цены он самый высокий: без ключа цены она встала бы первой.
  // В ярусе «$» три карточки, и взвешенный рейтинг (4,43 > 3,5 > 3,06) ставит их
  // иначе, чем число отзывов (40 > 10 > 0) и имя, — так видно, что внутри яруса
  // с ценой порядок прежний.
  const CARDS = [
    // [имя, price_range, average_rating, review_count]
    ['Дорогая', '$$$$', 0, 0],
    ['Средняя', '$$', 0, 0],
    ['Дешёвая, хвалёная', '$', 4.9, 10],
    ['Дешёвая', '$', 0, 0],
    ['Дешёвая, много отзывов', '$', 3.0, 40],
    ['Без цены, хвалёная', null, 4.9, 40],
    ['Без цены, без отзывов', null, 0, 0],
  ];
  const CHEAP_TIER = ['Дешёвая, хвалёная', 'Дешёвая', 'Дешёвая, много отзывов'];
  const NO_PRICE_TIER = ['Без цены, хвалёная', 'Без цены, без отзывов'];

  beforeEach(async () => {
    for (const [name, priceRange, rating, reviews] of CARDS) {
      await query(`
        INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, price_range, average_rating, review_count, status, working_hours, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], $3, $4, $5, 'active', $6::jsonb, NOW(), NOW())
      `, [partnerId, name, priceRange, rating, reviews, defaultWorkingHours]);
    }
  });

  /** Одна сортировка через все двери, где выдачу можно упорядочить по цене. */
  async function namesOnEveryDoor(sortBy) {
    const names = (response) => {
      expect(response.status).toBe(200);
      return response.body.data.establishments.map((e) => e.name);
    };
    return {
      byRadius: names(await request(app)
        .get('/api/v1/search/establishments')
        .query({ latitude: 53.9, longitude: 27.5, radius: 10, sort_by: sortBy })),
      byRadiusInCity: names(await request(app)
        .get('/api/v1/search/establishments')
        .query({ latitude: 53.9, longitude: 27.5, city: 'Минск', sort_by: sortBy })),
      byCity: names(await request(app)
        .get('/api/v1/search/establishments')
        .query({ city: 'Минск', sort_by: sortBy })),
      publicCatalog: names(await request(app)
        .get('/api/v1/public/establishments')
        .query({ city: 'minsk', sort_by: sortBy })),
    };
  }

  const onEveryDoor = (expected) => ({
    byRadius: expected, byRadiusInCity: expected, byCity: expected, publicCatalog: expected,
  });

  test('«сначала дороже»: без цены — после «$», а не выше «$$$$»', async () => {
    expect(await namesOnEveryDoor('price_desc')).toEqual(onEveryDoor([
      'Дорогая', 'Средняя', ...CHEAP_TIER, ...NO_PRICE_TIER,
    ]));
  });

  test('«сначала дешевле»: без цены — после «$$$$»', async () => {
    expect(await namesOnEveryDoor('price_asc')).toEqual(onEveryDoor([
      ...CHEAP_TIER, 'Средняя', 'Дорогая', ...NO_PRICE_TIER,
    ]));
  });
});

describe('Search System - «%» и «_» в запросе ищутся буквально', () => {
  // Проход по панели модератора, после волны 3 (находка 1): шаблон строился
  // из ввода как есть, и «100%» находил «Бар 1000», а «_» — любую карточку.
  // Тот же текстовый поиск идёт в приложении (/search/establishments, с
  // координатами и без) и на сайте (каталог через searchWithoutLocation).
  const seedCard = async (name, latitude = 53.9, longitude = 27.5) => {
    const result = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, 'описание', 'Минск', 'Центр', $3, $4, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $5::jsonb, '$$', NOW(), NOW())
      RETURNING id
    `, [partnerId, name, latitude, longitude, defaultWorkingHours]);
    return result.rows[0].id;
  };
  const names = (response) => response.body.data.establishments.map((e) => e.name).sort();

  beforeEach(async () => {
    await seedCard('Бар 100%');
    await seedCard('Бар 1000');
    await seedCard('Кафе_Дом');
  });

  test('«100%» находит только карточку со знаком процента — и счётчик тот же', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ search: '100%' })
      .expect(200);

    expect(names(response)).toEqual(['Бар 100%']);
    expect(response.body.data.pagination.total).toBe(1);
  });

  test('«_» находит только карточку с подчёркиванием, а не все', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ search: '_' })
      .expect(200);

    expect(names(response)).toEqual(['Кафе_Дом']);
  });

  test('с координатами — то же правило', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ search: '100%', latitude: 53.9, longitude: 27.5 })
      .expect(200);

    expect(names(response)).toEqual(['Бар 100%']);
  });

  test('обычный запрос — как раньше: подстрока без учёта регистра', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ search: 'бар' })
      .expect(200);

    expect(names(response)).toEqual(['Бар 100%', 'Бар 1000']);
  });

  test('блюдо (строгое сопоставление с меню): «100%» — только позиция со знаком процента', async () => {
    const withMenu = async (cardName, itemName) => {
      const [card] = (await query('SELECT id FROM establishments WHERE name = $1', [cardName])).rows;
      const media = await query(
        `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url)
         VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png') RETURNING id`,
        [card.id],
      );
      await query(
        `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, position)
         VALUES ($1, $2, $3, 5.00, 0)`,
        [card.id, media.rows[0].id, itemName],
      );
    };
    await withMenu('Бар 100%', 'Сок 100%');
    await withMenu('Бар 1000', 'Сок 1000 мл');

    const { searchWithoutLocation } = await import('../../services/searchService.js');
    const literal = await searchWithoutLocation({ dish: '100%' });
    expect(literal.establishments.map((e) => e.name)).toEqual(['Бар 100%']);
    // Позиции с подчёркиванием нет ни в одном меню — «_» не находит ничего.
    const underscore = await searchWithoutLocation({ dish: '_' });
    expect(underscore.establishments).toEqual([]);
    const plain = await searchWithoutLocation({ dish: 'сок' });
    expect(plain.establishments.map((e) => e.name).sort()).toEqual(['Бар 100%', 'Бар 1000']);
  });
});
