/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * «Поделились»: от записи отправки до числа в кабинете партнёра — на живой базе.
 *
 * Юнит-тест модели видит SQL только подстроками на подменённом пуле и не заметил
 * бы ни опечатки в колонке, ни того, что запрос падает на базе без колонки. А
 * такая база на проде будет: код выкатывается сам, миграцию 039 применяют руками
 * позже, и в этот промежуток статистика партнёра и список его заведений обязаны
 * работать. Поэтому последний блок снимает колонку настоящим файлом отката и
 * возвращает настоящим файлом миграции.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import app from '../../server.js';
import redisClient, { connectRedis } from '../../config/redis.js';
import { clearAllData, query } from '../utils/database.js';
import { createPartnerAndGetToken, createTestEstablishment } from '../utils/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = (file) => readFileSync(resolve(__dirname, '../../../migrations', file), 'utf8');
const MIGRATE = migration('039_establishment_share_count.sql');
const ROLL_BACK = migration('039_rollback_establishment_share_count.sql');

let partnerToken;
let estId;
let otherEstId;

/** Строка счётчиков за день: `daysAgo` суток назад, отправок — `shares`. */
const dayOf = (establishmentId, daysAgo, shares) => query(
  `INSERT INTO establishment_analytics (establishment_id, date, share_count)
   VALUES ($1, CURRENT_DATE - $2::int, $3)`,
  [establishmentId, daysAgo, shares],
);

const todayRow = async (establishmentId) => {
  const { rows } = await query(
    `SELECT * FROM establishment_analytics
     WHERE establishment_id = $1 AND date = CURRENT_DATE`,
    [establishmentId],
  );
  return rows[0];
};

const overviewOf = async (establishmentId, period = '7d') => {
  const res = await request(app)
    .get('/api/v1/partner/analytics/overview')
    .query({ period })
    .set('Authorization', `Bearer ${partnerToken}`)
    .expect(200);
  return res.body.data.establishments.find((e) => e.establishment_id === establishmentId);
};

const listRowOf = async (establishmentId) => {
  const res = await request(app)
    .get('/api/v1/partner/establishments')
    .set('Authorization', `Bearer ${partnerToken}`)
    .expect(200);
  return res.body.data.establishments.find((e) => e.id === establishmentId);
};

/** Предел записей счётчиков — на адрес: соседний файл набора мог его выбрать. */
const clearRateLimitKeys = async () => {
  for (const pattern of ['ratelimit:analytics-write:*', 'ratelimit:ip:*']) {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) await redisClient.del(keys);
  }
};

beforeAll(async () => {
  if (!redisClient.isReady) await connectRedis();
});

beforeEach(async () => {
  await clearRateLimitKeys();
  await clearAllData();
  const { partner, token } = await createPartnerAndGetToken();
  partnerToken = token;
  estId = (await createTestEstablishment(partner.id)).id;
  otherEstId = (await createTestEstablishment(partner.id)).id;
});

afterAll(async () => {
  // Если блок без колонки упал посреди теста, следующий файл набора не должен
  // получить базу без неё.
  await query(MIGRATE);
});

describe('POST /establishments/:id/track-share', () => {
  test('без входа; считает отправки по дням и только у этой карточки', async () => {
    const first = await request(app)
      .post(`/api/v1/establishments/${estId}/track-share`)
      .expect(200);
    expect(first.body).toEqual({ success: true, data: { message: 'Share event recorded' } });

    await request(app).post(`/api/v1/establishments/${estId}/track-share`).expect(200);

    const row = await todayRow(estId);
    expect(row.share_count).toBe(2);
    expect(row.call_count).toBe(0);
    expect(await todayRow(otherEstId)).toBeUndefined();
  });

  test('день со звонком и день с отправкой — одна строка, числа не мешают друг другу', async () => {
    await request(app).post(`/api/v1/establishments/${estId}/track-call`).expect(200);
    await request(app).post(`/api/v1/establishments/${estId}/track-share`).expect(200);
    await request(app).post(`/api/v1/establishments/${estId}/track-call`).expect(200);

    const row = await todayRow(estId);
    expect(row.call_count).toBe(2);
    expect(row.share_count).toBe(1);
  });

  test('общий предел записей со звонком: чередованием счётчик не накрутить', async () => {
    const call = await request(app)
      .post(`/api/v1/establishments/${estId}/track-call`)
      .expect(200);
    const share = await request(app)
      .post(`/api/v1/establishments/${estId}/track-share`)
      .expect(200);

    expect(share.headers['x-ratelimit-limit']).toBe('60');
    expect(Number(share.headers['x-ratelimit-remaining']))
      .toBe(Number(call.headers['x-ratelimit-remaining']) - 1);
  });
});

describe('что видит партнёр', () => {
  test('сводка: за период, за всё время и изменение к прошлому периоду', async () => {
    await dayOf(estId, 2, 3); // в окне недели
    await dayOf(estId, 3, 1); // в окне недели
    await dayOf(estId, 10, 2); // прошлая неделя
    await dayOf(estId, 40, 5); // давно: только в итоге за всё время
    await dayOf(otherEstId, 2, 9); // чужая строка не подмешивается

    const shares = (await overviewOf(estId)).shares;

    expect(shares.in_period).toBe(4);
    expect(shares.total).toBe(11);
    expect(shares.change_percent).toBe(100);
  });

  test('заведение без отправок — нули, а не пропавшее поле', async () => {
    expect((await overviewOf(estId)).shares).toEqual({
      total: 0,
      in_period: 0,
      change_percent: 0,
    });
    expect((await listRowOf(estId)).share_count).toBe(0);
  });

  test('список заведений несёт итог за всё время — число на карточке в профиле', async () => {
    await dayOf(estId, 2, 3);
    await dayOf(estId, 40, 5);
    await dayOf(otherEstId, 2, 1);

    expect((await listRowOf(estId)).share_count).toBe(8);
    expect((await listRowOf(otherEstId)).share_count).toBe(1);
  });
});

describe('до миграции 039: код уже выкачен, колонки ещё нет', () => {
  afterEach(async () => {
    await query(MIGRATE);
  });

  test('сводка и список работают и показывают ноль; звонки считаются как были', async () => {
    await query(ROLL_BACK);

    await request(app).post(`/api/v1/establishments/${estId}/track-call`).expect(200);
    expect((await todayRow(estId)).call_count).toBe(1);

    expect((await overviewOf(estId)).shares).toEqual({ total: 0, in_period: 0, change_percent: 0 });
    expect((await listRowOf(estId)).share_count).toBe(0);
  });

  test('запись отправки не падает: ответ тот же, отправка потеряна', async () => {
    await query(ROLL_BACK);

    await request(app).post(`/api/v1/establishments/${estId}/track-share`).expect(200);

    expect(await todayRow(estId)).toBeUndefined();
  });

  test('миграция повторяема и возвращает счёт', async () => {
    await query(ROLL_BACK);
    await query(MIGRATE);
    await query(MIGRATE);

    await request(app).post(`/api/v1/establishments/${estId}/track-share`).expect(200);

    expect((await todayRow(estId)).share_count).toBe(1);
  });
});
