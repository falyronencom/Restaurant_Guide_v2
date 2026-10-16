/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: фильтр на входе API (middleware/requestGuard.js)
 *
 * До правки каждый отказ ниже доходил до базы и возвращался 500 (или 400 через
 * перевод `22P02`) с записью «Server error occurred» со стеком: проба стенда
 * 12.10.2026 и прогон этого файла на прежнем server.js. После правки NUL где
 * угодно в запросе → 400 INVALID_FORMAT, номер страницы выше 10 000 или
 * смещение выше 1 000 000 → 422 VALIDATION_ERROR; в журнале — предупреждение
 * «Client error occurred», ни одной записи «Server error occurred».
 *
 * Адреса — из брифа (каталог и карта, карточка / меню / отзывы по слагу, поиск
 * приложения, умный поиск) и из обхода кода (отзывы заведения и пользователя,
 * избранное, уведомления, кабинет партнёра, брони, админка) — по одному на род
 * разбора номера. / Every refusal here reached the database before the fix.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import { clearAllData } from '../utils/database.js';
import { createStandardTestUsers, createTestEstablishment } from '../utils/auth.js';

const NUL = String.fromCharCode(0);
const PAGE_1E18 = '1000000000000000000'; // (page − 1) × limit выходит за bigint → 22003
const PAGE_1E20 = '100000000000000000000'; // JS печатает OFFSET как 2e+21 → 22P02
const OFFSET_1E19 = '10000000000000000000';

/** Отказ 422 по полю пагинации: текст и тот же текст в details — как у validate(). */
const fieldRefusal = (field, message) => ({
  status: 422, code: 'VALIDATION_ERROR', message, details: [{ field, message }],
});
/** Отказ 400 за NUL: без details. */
const nulRefusal = (message) => ({ status: 400, code: 'INVALID_FORMAT', message, details: undefined });

const PAGE_TOO_LARGE = fieldRefusal('page', 'Page must not exceed 10000');
const PAGE_NOT_A_NUMBER = fieldRefusal('page', 'Page must be a number');
const OFFSET_TOO_LARGE = fieldRefusal('offset', 'Offset must not exceed 1000000');
const OFFSET_NOT_A_NUMBER = fieldRefusal('offset', 'Offset must be a number');
const URL_NUL = nulRefusal('Request URL contains a NUL character (U+0000)');
const BODY_NUL = nulRefusal('В тексте есть невидимый символ, который нельзя отправить. Наберите текст заново и попробуйте ещё раз.');

let users;
let establishment;
let errorSpy;
let warnSpy;

beforeAll(async () => {
  await clearAllData();
  users = await createStandardTestUsers();
  establishment = await createTestEstablishment(users.partner.user.id);
});

beforeEach(() => {
  errorSpy = jest.spyOn(logger, 'error');
  warnSpy = jest.spyOn(logger, 'warn');
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

const bearer = (who) => `Bearer ${users[who].accessToken}`;

/** Ответ не дошёл до ошибки сервера: в журнале нет «Server error occurred». */
function expectNoServerErrorLogged() {
  const serverErrors = errorSpy.mock.calls.filter(([message]) => message === 'Server error occurred');
  expect(serverErrors).toEqual([]);
}

/**
 * Отказ фильтра: статус, свой код, текст и details (не SQLSTATE) — сверяется
 * ответ, а не AppError, так что и errorHandler, потерявший details, виден
 * здесь; предупреждение в журнале.
 */
function expectRefused(res, { status, code, message, details }) {
  expect(res.status).toBe(status);
  expect(res.body.success).toBe(false);
  expect(res.body.error.code).toBe(code);
  expect(res.body.message).toBe(message);
  expect(res.body.error.details).toEqual(details);
  expectNoServerErrorLogged();
  expect(warnSpy).toHaveBeenCalledWith(
    'Client error occurred',
    expect.objectContaining({ statusCode: status, errorCode: code }),
  );
}

describe('номер страницы выше 10 000 → 422', () => {
  const slugReviews = () => `/api/v1/public/establishments/by-slug/${establishment.slug}/reviews`;

  test.each([
    ['каталог, 10^18 (до правки 500)', () => `/api/v1/public/establishments?city=minsk&page=${PAGE_1E18}`],
    ['каталог, 10^20 (до правки 400 с записью ошибки)', () => `/api/v1/public/establishments?city=minsk&page=${PAGE_1E20}`],
    ['каталог, 10 001 (до правки — пустая страница)', () => '/api/v1/public/establishments?city=minsk&page=10001'],
    ['отзывы по слагу, 10^18', () => `${slugReviews()}?page=${PAGE_1E18}`],
    ['отзывы по слагу, 10^20', () => `${slugReviews()}?page=${PAGE_1E20}`],
    ['поиск приложения без координат, 10^18', () => `/api/v1/search/establishments?page=${PAGE_1E18}`],
    ['поиск приложения с координатами, 10^18', () => `/api/v1/search/establishments?latitude=53.9&longitude=27.56&page=${PAGE_1E18}`],
    ['отзывы заведения, 10^18', () => `/api/v1/establishments/${establishment.id}/reviews?page=${PAGE_1E18}`],
    ['отзывы пользователя, 10^18', () => `/api/v1/users/${users.regular.user.id}/reviews?page=${PAGE_1E18}`],
  ])('%s', async (_label, url) => {
    const res = await request(app).get(url());
    expectRefused(res, PAGE_TOO_LARGE);
  });

  test.each([
    ['избранное', 'regular', '/api/v1/favorites'],
    ['уведомления', 'regular', '/api/v1/notifications'],
    ['кабинет партнёра: свои заведения', 'partner', '/api/v1/partner/establishments'],
    ['админка: очередь модерации', 'admin', '/api/v1/admin/establishments/pending'],
  ])('%s, 10^18', async (_label, who, path) => {
    const res = await request(app)
      .get(`${path}?page=${PAGE_1E18}`)
      .set('Authorization', bearer(who));
    expectRefused(res, PAGE_TOO_LARGE);
  });

  test('умный поиск: номер числом в JSON-теле, 10^18', async () => {
    const res = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца', page: Number(PAGE_1E18) });
    expectRefused(res, PAGE_TOO_LARGE);
  });

  test('ровно 10 000 — по-прежнему честно пустая страница', async () => {
    const catalog = await request(app).get('/api/v1/public/establishments?city=minsk&page=10000');
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.establishments).toEqual([]);
    expect(catalog.body.data.pagination.page).toBe(10000);

    const reviews = await request(app).get(`${slugReviews()}?page=10000`);
    expect(reviews.status).toBe(200);

    const smart = await request(app).post('/api/v1/search/smart').send({ query: 'пицца', page: 10000 });
    expect(smart.status).toBe(200);
    expect(smart.body.data.establishments).toEqual([]);

    expectNoServerErrorLogged();
  });
});

describe('смещение выше 1 000 000 → 422', () => {
  test('поиск приложения, 10^19 (до правки 500)', async () => {
    const res = await request(app).get(`/api/v1/search/establishments?offset=${OFFSET_1E19}`);
    expectRefused(res, OFFSET_TOO_LARGE);
  });

  test('брони партнёра, 10^19 (до правки 500)', async () => {
    const res = await request(app)
      .get(`/api/v1/partner/bookings/${establishment.id}?offset=${OFFSET_1E19}`)
      .set('Authorization', bearer('partner'));
    expectRefused(res, OFFSET_TOO_LARGE);
  });

  test('ровно 1 000 000 — по-прежнему пустая выдача', async () => {
    const res = await request(app).get('/api/v1/search/establishments?offset=1000000');
    expect(res.status).toBe(200);
    expect(res.body.data.establishments).toEqual([]);
    expectNoServerErrorLogged();
  });
});

describe('номер без текстовой формы → 422, а не 500', () => {
  // ?page[toString]=x — объект, чей toString не функция: parseInt бросает
  // TypeError. До правки так падали обработчики, читающие номер (каталог,
  // поиск, умный поиск — 500); первая версия фильтра роняла так любой адрес
  // /api, даже проверку здоровья (ревью 13.10).
  test.each([
    ['проверка здоровья — номер не читает вовсе', '/api/v1/health?page%5BtoString%5D=x', PAGE_NOT_A_NUMBER],
    ['каталог (до правки 500)', '/api/v1/public/establishments?city=minsk&page%5BtoString%5D=x', PAGE_NOT_A_NUMBER],
    ['поиск приложения: смещение (до правки 500)', '/api/v1/search/establishments?offset%5BtoString%5D=1', OFFSET_NOT_A_NUMBER],
  ])('%s', async (_label, url, refusal) => {
    const res = await request(app).get(url);
    expectRefused(res, refusal);
  });

  test('умный поиск: номер объектом в JSON-теле (до правки 500)', async () => {
    const res = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца', page: { toString: 1 } });
    expectRefused(res, PAGE_NOT_A_NUMBER);
  });
});

describe('NUL в адресе → 400', () => {
  const bySlug = '/api/v1/public/establishments/by-slug';

  test.each([
    ['каталог: цена', '/api/v1/public/establishments?city=minsk&priceRange=%00'],
    ['каталог: фраза', '/api/v1/public/establishments?city=minsk&search=%00'],
    ['каталог: NUL внутри фразы', '/api/v1/public/establishments?city=minsk&search=pizza%00'],
    ['каталог: удобство из белого списка (до правки 200)', '/api/v1/public/establishments?city=minsk&features=%00'],
    ['карта: цена', '/api/v1/public/establishments/map?city=minsk&priceRange=%00'],
    ['карта: фраза', '/api/v1/public/establishments/map?city=minsk&search=%00'],
    ['карточка по слагу', `${bySlug}/%00`],
    ['меню по слагу', `${bySlug}/%00/menu-items`],
    ['отзывы по слагу', `${bySlug}/%00/reviews`],
    ['хвост настоящего слага', () => `${bySlug}/${establishment.slug}%00`],
    ['карточка по id', '/api/v1/public/establishments/by-id/%00'],
    ['поиск приложения: город', '/api/v1/search/establishments?city=%00'],
    ['поиск приложения: фраза', '/api/v1/search/establishments?search=%00'],
    ['поиск приложения: цена', '/api/v1/search/establishments?priceRange=%00'],
    ['карта поиска: фраза', '/api/v1/search/map?minLat=53&maxLat=54&minLon=27&maxLon=28&search=%00'],
  ])('%s', async (_label, url) => {
    const res = await request(app).get(typeof url === 'function' ? url() : url);
    expectRefused(res, URL_NUL);
  });

  test('«%2500» — закодированный знак процента, а не NUL: слаг просто не найден', async () => {
    const res = await request(app).get(`${bySlug}/%2500`);
    expect(res.status).toBe(404);
    expectNoServerErrorLogged();
  });

  test('U+0001 база принимает — фильтр его не трогает', async () => {
    const res = await request(app).get('/api/v1/public/establishments?city=minsk&priceRange=%01');
    expect(res.status).toBe(200);
    expectNoServerErrorLogged();
  });
});

describe('NUL в теле → 400', () => {
  test.each([
    ['умный поиск: город', { query: 'пицца', city: NUL }],
    ['умный поиск: цена', { query: 'пицца', priceRange: [NUL] }],
    ['умный поиск: фраза (до правки NUL молча вычищался, 200)', { query: `пицца${NUL}` }],
  ])('%s', async (_label, body) => {
    const res = await request(app).post('/api/v1/search/smart').send(body);
    expectRefused(res, BODY_NUL);
  });

  test('отзыв: текст', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', bearer('regular'))
      .send({ establishmentId: establishment.id, rating: 5, content: `Отлично${NUL}` });
    expectRefused(res, BODY_NUL);
  });

  test('карточка партнёра: название', async () => {
    const res = await request(app)
      .put(`/api/v1/partner/establishments/${establishment.id}`)
      .set('Authorization', bearer('partner'))
      .send({ name: `Кафе${NUL}` });
    expectRefused(res, BODY_NUL);
  });

  test('форма application/x-www-form-urlencoded: %00 в теле, а не в адресе', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .type('form')
      .send('email=test-user%40test.com&password=Test123%00');
    expectRefused(res, BODY_NUL);
  });
});
