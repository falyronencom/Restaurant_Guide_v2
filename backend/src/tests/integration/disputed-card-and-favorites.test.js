/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Две находки разведки 09.11.2026, вошедшие в шаг 1 нитки «Фото людей»
 * (docs/handoffs/ugc_moderation_step1_20261110/DIRECTIVE.md §2 пп. 11–12).
 *
 * Находка 3. Карточку, приостановленную после перехвата учётки, нельзя было
 * править, но можно было менять её фото, обложку и акции: снятие паузы вывело
 * бы их к гостям мимо модератора (решение Координатора 01.11.2026, «Р2»).
 * Теперь все шесть путей отказывают тем же текстом и кодом, что правка.
 *
 * Находка 4. Избранное отдавало название и первое фото карточки в любом
 * статусе, кроме архива, а добавить можно было и неодобренную. Теперь список —
 * только карточки в каталоге, строка остаётся; добавить можно только такую.
 *
 * На старом коде красный каждый тест «отказ» и «только в каталоге».
 */

import { randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import cloudinary from '../../config/cloudinary.js';
import { ESTABLISHMENT_REFUSALS } from '../../constants/establishmentRefusals.js';
import { TAKEOVER_SUSPEND_REASON } from '../../utils/moderationNotes.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';

const JPEG = { filename: 'photo.jpg', contentType: 'image/jpeg' };

let partner;
let card;
let upload;

const asPartner = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${partner.accessToken}`);

const park = (establishmentId, reason = TAKEOVER_SUSPEND_REASON) => query(
  `UPDATE establishments SET status = 'suspended', moderation_notes = $2 WHERE id = $1`,
  [establishmentId, JSON.stringify({ suspend_reason: reason, suspended_at: '2026-11-01T10:00:00.000Z', suspended_from: 'active' })],
);

const addMedia = async (establishmentId) => (await query(
  `INSERT INTO establishment_media (id, establishment_id, type, url, thumbnail_url, preview_url, file_type, position)
   VALUES ($1, $2, 'interior', $3, $3, $3, 'image', 0) RETURNING id`,
  [randomUUID(), establishmentId, `https://res.cloudinary.com/test/image/upload/v1/establishments/${establishmentId}/interior/a0001.jpg`],
)).rows[0].id;

const addPromotion = async (establishmentId) => (await query(
  `INSERT INTO promotions (establishment_id, title, valid_from, status)
   VALUES ($1, 'Скидка 10 %', CURRENT_DATE, 'active') RETURNING id`,
  [establishmentId],
)).rows[0].id;

const expectDispute = (response) => {
  expect(response.status).toBe(403);
  expect([response.body.error.code, response.body.message])
    .toEqual(['OWNERSHIP_DISPUTE', ESTABLISHMENT_REFUSALS.editOwnershipDispute]);
};

beforeEach(async () => {
  await clearAllData();
  ({ partner, establishment: card } = await createPartnerWithEstablishment('active'));
  upload = jest.spyOn(cloudinary.uploader, 'upload').mockImplementation(async (_path, options) => ({
    public_id: `${options.folder}/new0001`,
    secure_url: `https://res.cloudinary.com/test/image/upload/v1/${options.folder}/new0001.jpg`,
    width: 800, height: 600, format: 'jpg', bytes: 4096,
  }));
  jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

describe('находка 3: карточка после перехвата учётки закрыта для фото и акций', () => {
  test('шесть путей — отказ текстом правки; в облако ничего не уходит, в базе ничего не меняется', async () => {
    const mediaId = await addMedia(card.id);
    const promotionId = await addPromotion(card.id);
    await park(card.id);

    expectDispute(await asPartner('post', `/api/v1/partner/establishments/${card.id}/media`)
      .field('type', 'interior')
      .attach('file', Buffer.from('fake-jpeg'), JPEG));
    expectDispute(await asPartner('put', `/api/v1/partner/establishments/${card.id}/media/${mediaId}`)
      .send({ is_primary: true }));
    expectDispute(await asPartner('delete', `/api/v1/partner/establishments/${card.id}/media/${mediaId}`));
    expectDispute(await asPartner('post', '/api/v1/partner/promotions')
      .field('establishment_id', card.id)
      .field('title', 'Новая акция')
      .attach('image', Buffer.from('fake-jpeg'), JPEG));
    expectDispute(await asPartner('patch', `/api/v1/partner/promotions/${promotionId}`)
      .send({ title: 'Правка акции' }));
    expectDispute(await asPartner('delete', `/api/v1/partner/promotions/${promotionId}`));

    expect(upload).not.toHaveBeenCalled();
    expect((await query('SELECT id, is_primary FROM establishment_media WHERE establishment_id = $1', [card.id])).rows)
      .toEqual([{ id: mediaId, is_primary: false }]);
    expect((await query('SELECT title, status FROM promotions WHERE establishment_id = $1', [card.id])).rows)
      .toEqual([{ title: 'Скидка 10 %', status: 'active' }]);
  });

  test('приостановка модератором по содержанию — фото и акции партнёр меняет, как раньше', async () => {
    const mediaId = await addMedia(card.id);
    const promotionId = await addPromotion(card.id);
    await park(card.id, 'Фото не соответствуют заведению');

    await asPartner('put', `/api/v1/partner/establishments/${card.id}/media/${mediaId}`)
      .send({ is_primary: true }).expect(200);
    await asPartner('patch', `/api/v1/partner/promotions/${promotionId}`)
      .send({ title: 'Правка акции' }).expect(200);
  });
});

describe('находка 4: избранное — только карточки в каталоге', () => {
  const guest = async () => createUserAndGetTokens({
    email: `fav-${randomUUID()}@test.com`, password: 'Person123!@#', name: 'Гость Тестов', role: 'user', authMethod: 'email',
  });
  const favorites = async (who) => (await request(app).get('/api/v1/favorites')
    .set('Authorization', `Bearer ${who.accessToken}`).expect(200)).body.data;

  test('карточка ушла из каталога — в списке её нет, счёт сходится; строка жива и карточка возвращается', async () => {
    const who = await guest();
    const { establishment: other } = await createPartnerWithEstablishment('active');
    for (const id of [card.id, other.id]) {
      await request(app).post('/api/v1/favorites').set('Authorization', `Bearer ${who.accessToken}`)
        .send({ establishmentId: id }).expect(201);
    }

    for (const status of ['suspended', 'pending', 'draft', 'rejected', 'archived']) {
      await query('UPDATE establishments SET status = $2 WHERE id = $1', [card.id, status]);
      const answer = await favorites(who);
      expect(answer.favorites.map((f) => f.establishment_id)).toEqual([other.id]);
      expect(answer.pagination.total).toBe(1);
    }
    expect((await query('SELECT COUNT(*)::int AS n FROM favorites WHERE user_id = $1', [who.user.id])).rows[0].n).toBe(2);

    await query("UPDATE establishments SET status = 'active' WHERE id = $1", [card.id]);
    expect((await favorites(who)).favorites.map((f) => f.establishment_id).sort()).toEqual([card.id, other.id].sort());
  });

  test('карточку вне каталога не добавить; убрать из избранного — можно', async () => {
    const who = await guest();
    await request(app).post('/api/v1/favorites').set('Authorization', `Bearer ${who.accessToken}`)
      .send({ establishmentId: card.id }).expect(201);

    for (const status of ['pending', 'draft', 'suspended', 'rejected']) {
      const { establishment: hidden } = await createPartnerWithEstablishment(status);
      const refused = await request(app).post('/api/v1/favorites').set('Authorization', `Bearer ${who.accessToken}`)
        .send({ establishmentId: hidden.id });
      expect([status, refused.status, refused.body.error.code]).toEqual([status, 404, 'ESTABLISHMENT_NOT_FOUND']);
    }

    await query("UPDATE establishments SET status = 'suspended' WHERE id = $1", [card.id]);
    await request(app).delete(`/api/v1/favorites/${card.id}`).set('Authorization', `Bearer ${who.accessToken}`).expect(200);
    expect((await query('SELECT COUNT(*)::int AS n FROM favorites WHERE user_id = $1', [who.user.id])).rows[0].n).toBe(0);
  });
});
