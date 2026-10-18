/* eslint-env jest */
/**
 * Второй ключ `id` во всех порядках отзывов (проход тестировщика 17.10,
 * отчёт П12, находка 1). Страницы режутся по OFFSET; без последнего ключа два
 * отзыва с одинаковым временем (и рейтингом) приходят в любом порядке от
 * запроса к запросу, и на стыке страниц один показывается дважды, а другой не
 * показывается вовсе.
 *
 * У всех отзывов здесь одно время и одна оценка: порядок задаёт только `id`.
 * Список, собранный по страницам, должен быть ровно всеми отзывами в порядке
 * `id` — убывания (сначала новые, по оценке) или возрастания (сначала старые в
 * панели: это разворот «сначала новые», им же пользуется приложение).
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment } from '../utils/auth.js';
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';

const COUNT = 12;
const PAGE = 5;
const SAME_TIME = '2026-10-01 12:00:00';

const insertUser = async (n) => (await query(
  `INSERT INTO users (id, email, password_hash, name, role, auth_method, is_active, created_at, updated_at)
   VALUES ($1, $2, 'x', $3, $4, 'email', true, NOW(), NOW())
   RETURNING id`,
  [randomUUID(), `order-${n}-${randomUUID().slice(0, 8)}@test.com`, `Гость ${n}`, n === 'partner' ? 'partner' : 'user'],
)).rows[0].id;

const insertReview = async (userId, establishmentId) => (await query(
  `INSERT INTO reviews (id, user_id, establishment_id, rating, content, text, created_at, updated_at)
   VALUES (gen_random_uuid(), $1, $2, 4, $3, $3, $4, $4)
   RETURNING id`,
  [userId, establishmentId, 'Отзыв для проверки порядка на стыке страниц.', SAME_TIME],
)).rows[0].id;

const byIdDesc = (ids) => [...ids].sort().reverse();
const byIdAsc = (ids) => [...ids].sort();

/** Все страницы подряд: page 1, 2, 3 … по PAGE штук. */
const collect = async (fetchPage) => {
  const ids = [];
  for (let page = 1; page <= Math.ceil(COUNT / PAGE); page++) {
    ids.push(...await fetchPage(page));
  }
  return ids;
};

let admin;

beforeAll(async () => {
  await clearAllData();
  admin = await createAdminAndGetToken();
});

afterAll(async () => {
  await clearAllData();
});

describe('отзывы заведения: каждый порядок доводит ничью по id', () => {
  let establishmentId;
  let reviewIds;

  beforeAll(async () => {
    const partnerId = await insertUser('partner');
    establishmentId = (await createTestEstablishment(partnerId)).id;
    reviewIds = [];
    for (let n = 0; n < COUNT; n++) {
      reviewIds.push(await insertReview(await insertUser(n), establishmentId));
    }
  });

  test.each(['newest', 'highest', 'lowest'])('sort=%s: страницы — все отзывы по убыванию id', async (sort) => {
    const ids = await collect(async (page) => {
      const response = await request(app)
        .get(`/api/v1/establishments/${establishmentId}/reviews`)
        .query({ page, limit: PAGE, sort })
        .expect(200);
      return response.body.data.reviews.map((review) => review.id);
    });
    expect(ids).toEqual(byIdDesc(reviewIds));
  });

  test.each([
    ['newest', byIdDesc],
    ['oldest', byIdAsc],
    ['rating_high', byIdDesc],
    ['rating_low', byIdDesc],
  ])('панель, sort=%s: страницы — все отзывы по id', async (sort, expected) => {
    const ids = await collect(async (page) => {
      const response = await request(app)
        .get('/api/v1/admin/reviews')
        .query({ page, per_page: PAGE, sort, establishment_id: establishmentId })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      return response.body.data.map((review) => review.id);
    });
    expect(ids).toEqual(expected(reviewIds));
  });
});

describe('отзывы человека: ничья по времени доводится по id', () => {
  test('страницы — все отзывы по убыванию id', async () => {
    const authorId = await insertUser('author');
    const partnerId = await insertUser('partner');
    const reviewIds = [];
    for (let n = 0; n < COUNT; n++) {
      const establishment = await createTestEstablishment(partnerId);
      await query("UPDATE establishments SET status = 'active' WHERE id = $1", [establishment.id]);
      reviewIds.push(await insertReview(authorId, establishment.id));
    }

    const ids = await collect(async (page) => {
      const response = await request(app)
        .get(`/api/v1/users/${authorId}/reviews`)
        .query({ page, limit: PAGE })
        .expect(200);
      return response.body.data.reviews.map((review) => review.id);
    });
    expect(ids).toEqual(byIdDesc(reviewIds));
  });
});
