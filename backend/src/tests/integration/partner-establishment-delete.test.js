/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Удалить карточку навсегда партнёр может, только пока она черновик или
 * отклонена (внешний обзор 23.09.2026, #4a; решение Координатора 24.09 —
 * отказ, а не архив).
 *
 * DELETE карточки уносит каскадом всё, что на неё ссылается: отзывы и
 * избранное пользователей, брони, медиа, меню, акции. Сервер удалял карточку
 * любого статуса, mobile показывал «Удалить заведение» всегда, и только сайт
 * прятал кнопку — а правило, которое живёт лишь в интерфейсе клиента, не
 * существует.
 *
 * Сторож идёт по ВСЕМ статусам из CHECK таблицы establishments, прочитанным из
 * каталога базы: статус, добавленный позже, попадёт под проверку сам и обязан
 * получить отказ — удаляются только два названных. Что разбор CHECK не ослеп,
 * держит якорь: шесть известных статусов обязаны в нём найтись.
 *
 * «Отклонена» ещё не значит «гости её не видели» (ревью 30.09, HIGH; решение
 * Координатора 01.10.2026): активная карточка → приостановка → повторная
 * отправка → отказ модератора — и она снова «отклонённая», уже с отзывами,
 * избранным и бронями гостей. Признак «была на сайте» — published_at: его
 * ставит первое одобрение (и пакетный импорт), и ничто его не сбрасывает.
 * Карточку, которая была на сайте, партнёр не удаляет ни в каком статусе.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';
import * as EstablishmentModel from '../../models/establishmentModel.js';
import { processCard } from '../../../scripts/seed-import/pipeline.js';

/** Спецификация: удаляются только эти два статуса — и только у карточки, которой не было на сайте. */
const DELETABLE = ['draft', 'rejected'];
/** Решение Координатора 01.10.2026 — текст, который читает партнёр. */
const REFUSAL = 'Удалить можно только черновик или отклонённую карточку, которая ещё не была на сайте. Чтобы убрать эту карточку, напишите в поддержку.';
/** Якорь разбора CHECK: статусы, которые в нём заведомо есть. */
const KNOWN_STATUSES = ['draft', 'pending', 'active', 'rejected', 'suspended', 'archived'];

let partner;
let otherPartner;
let fan;
let admin;

const phone = () => `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

/** Статусы из CHECK establishments_status_check — из каталога базы, не из кода. */
async function checkStatuses() {
  const { rows } = await query(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.conrelid = 'establishments'::regclass
        AND c.conname = 'establishments_status_check'`,
  );
  return [...rows[0].def.matchAll(/'([a-z_]+)'::/g)].map((m) => m[1]);
}

/**
 * Карточка партнёра в заданном статусе — с избранным пользователя на ней.
 * published: карточка уже была на сайте (published_at = сейчас); иначе
 * published_at пуст, как у карточки, которую ни разу не одобряли.
 */
async function cardInStatus(owner, status, { name, city, published = false } = {}) {
  const est = await createTestEstablishment(owner.user.id);
  await query(
    `UPDATE establishments
        SET status = $2, name = COALESCE($3, name), city = COALESCE($4, city),
            published_at = CASE WHEN $5::boolean THEN NOW() END
      WHERE id = $1`,
    [est.id, status, name ?? null, city ?? null, published],
  );
  await query('INSERT INTO favorites (user_id, establishment_id) VALUES ($1, $2)', [fan.user.id, est.id]);
  return est.id;
}

const count = async (sql, params) => (await query(sql, params)).rows[0].n;
const cardsLeft = (id) => count('SELECT count(*)::int AS n FROM establishments WHERE id = $1', [id]);
const favoritesLeft = (id) => count('SELECT count(*)::int AS n FROM favorites WHERE establishment_id = $1', [id]);
const deletionRecords = (id) => count(
  "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'partner_delete_establishment'",
  [id],
);

const deleteAs = (who, id) => request(app)
  .delete(`/api/v1/partner/establishments/${id}`)
  .set('Authorization', `Bearer ${who.accessToken}`);

beforeAll(async () => {
  partner = await createUserAndGetTokens({
    email: 'delete-owner-partner@test.com', phone: phone(), password: 'Partner123!@#', name: 'Партнёр Владелец', role: 'partner',
  });
  otherPartner = await createUserAndGetTokens({
    email: 'delete-other-partner@test.com', phone: phone(), password: 'Partner123!@#', name: 'Чужой партнёр', role: 'partner',
  });
  fan = await createUserAndGetTokens({
    email: 'delete-fan-user@test.com', phone: phone(), password: 'User123!@#', name: 'Гость', role: 'user',
  });
  admin = await createAdminAndGetToken();
});

afterAll(async () => {
  await clearAllData();
});

describe('DELETE /partner/establishments/:id — только черновик и отклонённая карточка', () => {
  it('якорь: разбор CHECK видит все известные статусы', async () => {
    expect(await checkStatuses()).toEqual(expect.arrayContaining(KNOWN_STATUSES));
  });

  it('каждый статус из CHECK: удаляются только draft и rejected, остальным — 403, карточка и чужие данные на месте', async () => {
    const statuses = await checkStatuses();
    const outcomes = {};
    for (const status of statuses) {
      const id = await cardInStatus(partner, status);
      const res = await deleteAs(partner, id);
      outcomes[status] = {
        http: res.status,
        code: res.body.error?.code ?? null,
        cardsLeft: await cardsLeft(id),
        favoritesLeft: await favoritesLeft(id),
        deletionRecords: await deletionRecords(id),
      };
    }

    const expected = Object.fromEntries(statuses.map((status) => [status, DELETABLE.includes(status)
      ? { http: 200, code: null, cardsLeft: 0, favoritesLeft: 0, deletionRecords: 1 }
      : { http: 403, code: 'ESTABLISHMENT_NOT_DELETABLE', cardsLeft: 1, favoritesLeft: 1, deletionRecords: 0 }]));
    expect(outcomes).toEqual(expected);
  });

  it('карточку, которая была на сайте, не удалить ни в каком статусе из CHECK: 403, карточка и избранное гостя на месте', async () => {
    const statuses = await checkStatuses();
    const outcomes = {};
    for (const status of statuses) {
      const id = await cardInStatus(partner, status, { published: true });
      const res = await deleteAs(partner, id);
      outcomes[status] = {
        http: res.status,
        code: res.body.error?.code ?? null,
        cardsLeft: await cardsLeft(id),
        favoritesLeft: await favoritesLeft(id),
        deletionRecords: await deletionRecords(id),
      };
    }

    const refused = { http: 403, code: 'ESTABLISHMENT_NOT_DELETABLE', cardsLeft: 1, favoritesLeft: 1, deletionRecords: 0 };
    expect(outcomes).toEqual(Object.fromEntries(statuses.map((status) => [status, refused])));
  });

  it('отказ говорит партнёру, что делать, — текстом решения', async () => {
    const id = await cardInStatus(partner, 'active');
    const res = await deleteAs(partner, id);

    expect(res.status).toBe(403);
    // Конверт ошибки: текст — в message верхнего уровня, код — в error.code;
    // mobile показывает этот текст как есть (ApiClient._extractErrorMessage).
    expect(res.body).toMatchObject({ message: REFUSAL, error: { code: 'ESTABLISHMENT_NOT_DELETABLE' } });
  });

  it('чужой черновик не удалить: 403 FORBIDDEN, черновик на месте', async () => {
    const id = await cardInStatus(partner, 'draft');
    const res = await deleteAs(otherPartner, id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await cardsLeft(id)).toBe(1);
    expect(await deletionRecords(id)).toBe(0);
  });

  it('модель отказывает сама, в обход сервиса: условие статуса — в самом DELETE', async () => {
    const id = await cardInStatus(partner, 'active');

    expect(await EstablishmentModel.deleteEstablishment(id, partner.user.id)).toBeNull();
    expect(await cardsLeft(id)).toBe(1);
    expect(await deletionRecords(id)).toBe(0);
  });

  it('модель отказывает сама и отклонённой карточке, которая была на сайте: условие published_at — в самом DELETE', async () => {
    const id = await cardInStatus(partner, 'rejected', { published: true });

    expect(await EstablishmentModel.deleteEstablishment(id, partner.user.id)).toBeNull();
    expect(await cardsLeft(id)).toBe(1);
    expect(await deletionRecords(id)).toBe(0);
  });
});

describe('путь через приостановку: карточка была на сайте, после повторной отправки отклонена', () => {
  /** Шаг сценария настоящим маршрутом API; другой код ответа — сломан сценарий, а не правило. */
  const step = async (title, req, expected = 200) => {
    const res = await req;
    if (res.status !== expected) {
      throw new Error(`${title}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res;
  };
  const asPartner = (method, path) => request(app)[method](`/api/v1/partner/establishments${path}`)
    .set('Authorization', `Bearer ${partner.accessToken}`);
  const moderate = (id, body) => request(app)
    .post(`/api/v1/admin/establishments/${id}/moderate`)
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send(body);
  const reviewsLeft = (id) => count('SELECT count(*)::int AS n FROM reviews WHERE establishment_id = $1', [id]);

  it('одобрение → отзыв и избранное гостя → своя приостановка → повторная отправка → отказ модератора: удалить нельзя, отзыв и избранное гостя на месте', async () => {
    const est = await createTestEstablishment(partner.user.id);
    const id = est.id;
    await query("UPDATE establishments SET status = 'draft', published_at = NULL WHERE id = $1", [id]);

    await step('отправка черновика', asPartner('post', `/${id}/submit`));
    await step('одобрение', moderate(id, { action: 'approve' }));

    // Клиенты прячут «Удалить» по этому полю — оно обязано доходить до них
    // и в списке кабинета, и в карточке.
    const detail = await step('карточка партнёра', asPartner('get', `/${id}`));
    expect(detail.body.data.establishment.published_at).toEqual(expect.any(String));
    const list = await step('список партнёра', asPartner('get', ''));
    expect(list.body.data.establishments.find((e) => e.id === id).published_at).toEqual(expect.any(String));

    await step('отзыв гостя', request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${fan.accessToken}`)
      .send({ establishmentId: id, rating: 5, content: 'Были вчера с друзьями, всё понравилось — вернёмся ещё.' }), 201);
    await step('избранное гостя', request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${fan.accessToken}`)
      .send({ establishmentId: id }), 201);

    await step('своя приостановка', asPartner('post', `/${id}/suspend`));
    await step('повторная отправка', asPartner('post', `/${id}/submit`));
    await step('отказ модератора', moderate(id, { action: 'reject', moderation_notes: { description: 'Уточните описание' } }));
    const { rows: [card] } = await query('SELECT status, published_at FROM establishments WHERE id = $1', [id]);
    expect(card).toEqual({ status: 'rejected', published_at: expect.any(Date) });

    const res = await deleteAs(partner, id);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: REFUSAL, error: { code: 'ESTABLISHMENT_NOT_DELETABLE' } });
    expect({
      cardsLeft: await cardsLeft(id),
      reviewsLeft: await reviewsLeft(id),
      favoritesLeft: await favoritesLeft(id),
      deletionRecords: await deletionRecords(id),
    }).toEqual({ cardsLeft: 1, reviewsLeft: 1, favoritesLeft: 1, deletionRecords: 0 });

    // Дальше партнёр правит карточку по замечаниям, и mobile подменяет её в
    // кабинете ответом правки — признак обязан прийти и в нём, иначе пункт
    // «Удалить» вернётся на экран.
    const edited = await step('правка после отказа', asPartner('put', `/${id}`)
      .send({ description: 'Уточнили описание по замечанию модератора.' }));
    expect(edited.body.data.establishment.published_at).toEqual(expect.any(String));
  });
});

describe('пакетный импорт: карточку на сайт выводит активация — и ставит published_at', () => {
  // Импорт (scripts/seed-import, CAT-E-2.2) выводит карточку на сайт сам, в
  // обход модерации. Без published_at такая карточка после передачи партнёру,
  // приостановки, повторной отправки и отказа снова удалялась бы — правило
  // выше держится на том, что published_at ставит КАЖДЫЙ путь на сайт.
  it('конвейер, продолженный с последней фазы перед активацией, выводит карточку на сайт с published_at', async () => {
    const est = await createTestEstablishment(partner.user.id);
    await query("UPDATE establishments SET status = 'draft', published_at = NULL WHERE id = $1", [est.id]);
    const stableId = `delete-test-${est.id.slice(0, 8)}`;
    // Реестр — на фазе перед активацией: конвейер пропустит создание, медиа и
    // OCR и выполнит только активацию, как при возобновлении прерванной партии.
    await query(
      `INSERT INTO seed_import_registry (stable_id, establishment_id, batch_id, content_hash, phase)
       VALUES ($1, $2, 'batch-delete-test', 'h', 'ocr_enqueued')`,
      [stableId, est.id],
    );

    const outcome = await processCard(
      { db: { query }, batchId: 'batch-delete-test' },
      { stable_id: stableId, content_hash: 'h' },
      [],
    );

    expect(outcome).toMatchObject({ status: 'resumed', establishment_id: est.id });
    const { rows: [card] } = await query(
      'SELECT status, is_seed, published_at FROM establishments WHERE id = $1',
      [est.id],
    );
    expect(card).toEqual({ status: 'active', is_seed: true, published_at: expect.any(Date) });
  });
});

describe('журнал аудита: удаление видно и после того, как карточки не стало', () => {
  it('запись несёт автора, название, город и прежний статус; экран журнала показывает удалённую карточку', async () => {
    const id = await cardInStatus(partner, 'rejected', { name: 'Кофейня у моста', city: 'Гродно' });
    expect((await deleteAs(partner, id)).status).toBe(200);

    const { rows } = await query(
      "SELECT user_id, entity_type, old_data FROM audit_log WHERE entity_id = $1 AND action = 'partner_delete_establishment'",
      [id],
    );
    expect(rows).toEqual([{
      user_id: partner.user.id,
      entity_type: 'establishment',
      old_data: { name: 'Кофейня у моста', city: 'Гродно', status: 'rejected' },
    }]);

    const { body } = await request(app)
      .get('/api/v1/admin/audit-log?per_page=100')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    const entry = body.data.find((e) => e.entity_id === id);
    expect(entry).toMatchObject({
      action: 'partner_delete_establishment',
      summary: 'Заведение удалено партнёром',
      entity_context: { name: 'Кофейня у моста', city: 'Гродно' },
    });
  });
});
