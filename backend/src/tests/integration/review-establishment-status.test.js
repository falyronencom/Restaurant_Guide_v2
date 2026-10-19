/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Новый отзыв — только на карточку, которую гость видит в каталоге.
 *
 * До правки создание отзыва отсекало только архивные карточки: на модерации,
 * приостановленная модератором, отклонённая и черновик принимали отзыв, хотя
 * в каталоге гость их не видит (аудит честности тестов, вопрос В1; решение
 * Координатора 19.10.2026 — «отзывы принимать только на действующие карточки»).
 * Правило теперь — то же, что у публичного каталога: status = 'active';
 * остальные получают русский отказ 400 ESTABLISHMENT_NOT_ACTIVE (как бронь
 * в том же случае), и слот дневной квоты не тратится.
 *
 * Перечень состояний — из схемы (CHECK establishments_status_check), литералом;
 * сторож ниже сверяет его со схемой тестовой базы: появится новое состояние —
 * тест покраснеет, и решать, принимает ли оно отзывы, придётся явно.
 * Запрос — в той же форме, что шлёт приложение (mobile reviews_service.dart:
 * establishmentId, rating, content).
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query, countRecords } from '../utils/database.js';
import { createUserAndGetTokens, createTestEstablishment } from '../utils/auth.js';
import redisClient, { connectRedis, deleteKey, getCounter, setWithExpiry } from '../../config/redis.js';

const CONTENT = 'Достаточно длинный и содержательный отзыв длиной более двадцати символов.';
const REFUSAL = 'Это заведение сейчас не показывается в каталоге — оставить отзыв нельзя';
const SCHEMA_STATUSES = ['active', 'archived', 'draft', 'pending', 'rejected', 'suspended'];
const NOT_IN_CATALOGUE = ['draft', 'pending', 'rejected', 'suspended', 'archived'];

const quotaKey = (userId) => `reviews:ratelimit:${userId}`;

let author;
let authorToken;
let partnerId;

beforeAll(async () => {
  if (!redisClient.isReady) {
    const ready = await connectRedis();
    if (!ready) throw new Error('Redis is required: the test reads the quota counter');
  }
});

beforeEach(async () => {
  await clearAllData();
  const user = await createUserAndGetTokens({
    email: `status-author-${Date.now()}@test.com`,
    password: 'User123!@#',
    name: 'Автор Отзыва',
    role: 'user',
  });
  author = user.user;
  authorToken = user.accessToken;
  const partner = await createUserAndGetTokens({
    email: `status-partner-${Date.now()}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр',
    role: 'partner',
  });
  partnerId = partner.user.id;
  await deleteKey(quotaKey(author.id));
});

afterEach(async () => {
  if (author) await deleteKey(quotaKey(author.id));
});

afterAll(async () => {
  await clearAllData();
});

const establishmentWithStatus = async (status) => {
  const { id } = await createTestEstablishment(partnerId);
  await query('UPDATE establishments SET status = $1 WHERE id = $2', [status, id]);
  return id;
};

const submitReview = (establishmentId) => request(app)
  .post('/api/v1/reviews')
  .set('Authorization', `Bearer ${authorToken}`)
  .send({ establishmentId, rating: 4, content: CONTENT });

const reviewsOf = (establishmentId) =>
  countRecords('reviews', 'WHERE establishment_id = $1', [establishmentId]);

test('перечень состояний теста совпадает со схемой базы', async () => {
  const { rows } = await query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'establishments_status_check'
  `);
  expect(rows).toHaveLength(1);
  const inSchema = [...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  expect(inSchema).toEqual(SCHEMA_STATUSES);
  expect([...NOT_IN_CATALOGUE, 'active'].sort()).toEqual(SCHEMA_STATUSES);
});

describe('отзыв на карточку, которой нет в каталоге, не принимается', () => {
  test.each(NOT_IN_CATALOGUE)('состояние %s: отказ по-русски, отзыва нет, квота цела', async (status) => {
    const establishmentId = await establishmentWithStatus(status);

    const response = await submitReview(establishmentId);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_ACTIVE');
    expect(response.body.message).toBe(REFUSAL);
    expect(await reviewsOf(establishmentId)).toBe(0);
    expect(await getCounter(quotaKey(author.id))).toBe(0);
  });
});

test('действующая карточка принимает отзыв, как раньше', async () => {
  const establishmentId = await establishmentWithStatus('active');

  const response = await submitReview(establishmentId);

  expect(response.status).toBe(201);
  expect(response.body.data.review.establishment_id).toBe(establishmentId);
  expect(await reviewsOf(establishmentId)).toBe(1);
  expect(await getCounter(quotaKey(author.id))).toBe(1);
});

test('лимит исчерпан: на карточку вне каталога — отказ карточки, на действующую — отказ лимита', async () => {
  // Десять отзывов за минские сутки уже оставлены.
  await setWithExpiry(quotaKey(author.id), '10', 3600);
  const suspended = await establishmentWithStatus('suspended');
  const active = await establishmentWithStatus('active');

  const toSuspended = await submitReview(suspended);
  expect(toSuspended.status).toBe(400);
  expect(toSuspended.body.error.code).toBe('ESTABLISHMENT_NOT_ACTIVE');
  expect(toSuspended.body.message).toBe(REFUSAL);
  expect(await getCounter(quotaKey(author.id))).toBe(10);

  const toActive = await submitReview(active);
  expect(toActive.status).toBe(429);
  expect(toActive.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  expect(toActive.body.message).toBe(
    'Лимит отзывов на сегодня исчерпан: не больше 10 в день. Новый отзыв можно написать завтра.',
  );
  expect(await getCounter(quotaKey(author.id))).toBe(10);
  expect(await reviewsOf(suspended) + await reviewsOf(active)).toBe(0);
});

test('несуществующая карточка — по-прежнему 404 ESTABLISHMENT_NOT_FOUND', async () => {
  const response = await submitReview('00000000-0000-4000-8000-000000000000');

  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  expect(await getCounter(quotaKey(author.id))).toBe(0);
});
