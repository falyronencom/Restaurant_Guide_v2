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
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';
import * as EstablishmentModel from '../../models/establishmentModel.js';

/** Спецификация: удаляются только эти два статуса. */
const DELETABLE = ['draft', 'rejected'];
/** Решение Координатора 30.09.2026 — текст, который читает партнёр. */
const REFUSAL = 'Удалить можно только черновик или отклонённую карточку. Чтобы убрать эту карточку, напишите в поддержку.';
/** Якорь разбора CHECK: статусы, которые в нём заведомо есть. */
const KNOWN_STATUSES = ['draft', 'pending', 'active', 'rejected', 'suspended', 'archived'];

let partner;
let otherPartner;
let fan;

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

/** Карточка партнёра в заданном статусе — с избранным пользователя на ней. */
async function cardInStatus(owner, status, { name, city } = {}) {
  const est = await createTestEstablishment(owner.user.id);
  await query(
    `UPDATE establishments
        SET status = $2, name = COALESCE($3, name), city = COALESCE($4, city)
      WHERE id = $1`,
    [est.id, status, name ?? null, city ?? null],
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

    const admin = await createAdminAndGetToken();
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
