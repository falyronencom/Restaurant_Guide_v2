/* eslint-env jest */
/**
 * Отказы удаления и правки отзыва и ответа владельца — по-русски (проход
 * тестировщика 17.10, отчёт П10, находка 2). Приложение показывает текст
 * сервера как есть, если он русский; английский заменяло общей фразой —
 * человек видел «Не удалось удалить ответ», и когда ответ уже удалён с
 * другого устройства.
 *
 * Тексты проверяются дословно, через настоящие маршруты, вместе с конвертом:
 * статус и код не менялись — на них опираются приложение (PR #68, #69) и
 * старые тесты.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens, createTestEstablishment } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

let author;
let stranger;
let owner;
let otherOwner;
let establishmentId;

const insertReview = async ({ response = null } = {}) => (await query(
  `INSERT INTO reviews (id, user_id, establishment_id, rating, content, text, partner_response,
                        partner_response_at, created_at, updated_at)
   VALUES (gen_random_uuid(), $1, $2, 4, $3, $3, $4, CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END, NOW(), NOW())
   RETURNING id`,
  [author.user.id, establishmentId, 'Достаточно длинный отзыв для проверки отказов.', response],
)).rows[0].id;

const expectRefusal = (response, status, code, message) => {
  expect(response.status).toBe(status);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe(code);
  expect(response.body.message).toBe(message);
};

beforeAll(async () => {
  await clearAllData();
  author = await createUserAndGetTokens(testUsers.regularUser);
  stranger = await createUserAndGetTokens(testUsers.regularUser2);
  owner = await createUserAndGetTokens(testUsers.partner);
  otherOwner = await createUserAndGetTokens(testUsers.partner2);
});

beforeEach(async () => {
  await query('TRUNCATE TABLE reviews CASCADE');
  await query('TRUNCATE TABLE establishments CASCADE');
  establishmentId = (await createTestEstablishment(owner.user.id)).id;
});

afterAll(async () => {
  await clearAllData();
});

describe('удаление и правка отзыва автором', () => {
  test('чужой отзыв не удалить: 403 и русский текст', async () => {
    const reviewId = await insertReview();
    const response = await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expectRefusal(response, 403, 'UNAUTHORIZED_REVIEW_DELETION', 'Удалить можно только свой отзыв');
  });

  test('отзыв, удалённый раньше (другое устройство): 404 и русский текст', async () => {
    const reviewId = await insertReview();
    await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${author.accessToken}`)
      .expect(200);

    const again = await request(app)
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expectRefusal(again, 404, 'REVIEW_NOT_FOUND', 'Отзыв не найден — возможно, его уже удалили');
  });

  test('несуществующий отзыв: 404 и русский текст', async () => {
    const response = await request(app)
      .delete(`/api/v1/reviews/${randomUUID()}`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expectRefusal(response, 404, 'REVIEW_NOT_FOUND', 'Отзыв не найден — возможно, его уже удалили');
  });

  test('чужой отзыв не изменить: 403 и русский текст', async () => {
    const reviewId = await insertReview();
    const response = await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({ rating: 1 });
    expectRefusal(response, 403, 'UNAUTHORIZED_REVIEW_MODIFICATION', 'Изменить можно только свой отзыв');
  });
});

describe('ответ владельца', () => {
  test('ответа нет (уже удалён): 404 и русский текст', async () => {
    const reviewId = await insertReview();
    const response = await request(app)
      .delete(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expectRefusal(response, 404, 'RESPONSE_NOT_FOUND', 'У этого отзыва нет ответа — возможно, его уже удалили');
  });

  test('ответ у отзыва о чужом заведении не удалить: 403 и русский текст', async () => {
    const reviewId = await insertReview({ response: 'Спасибо за отзыв!' });
    const response = await request(app)
      .delete(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${otherOwner.accessToken}`);
    expectRefusal(
      response,
      403,
      'UNAUTHORIZED_PARTNER_RESPONSE',
      'Удалить ответ можно только у отзыва о своём заведении',
    );
    const stored = await query('SELECT partner_response FROM reviews WHERE id = $1', [reviewId]);
    expect(stored.rows[0].partner_response).toBe('Спасибо за отзыв!');
  });

  test('удалённый отзыв: удаление ответа — 404 и русский текст', async () => {
    const reviewId = await insertReview({ response: 'Спасибо за отзыв!' });
    await query('UPDATE reviews SET is_deleted = TRUE WHERE id = $1', [reviewId]);
    const response = await request(app)
      .delete(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expectRefusal(response, 404, 'REVIEW_NOT_FOUND', 'Отзыв не найден — возможно, его уже удалили');
  });

  test('на отзыв о чужом заведении не ответить: 403 и русский текст', async () => {
    const reviewId = await insertReview();
    const response = await request(app)
      .post(`/api/v1/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${otherOwner.accessToken}`)
      .send({ response: 'Спасибо за ваш отзыв!' });
    expectRefusal(
      response,
      403,
      'UNAUTHORIZED_PARTNER_RESPONSE',
      'Отвечать можно только на отзывы о своих заведениях',
    );
  });
});
