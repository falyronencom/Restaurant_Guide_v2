/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: длина полей карточки — как её считает база (находка Н15,
 * сессия Г нитки «Остатки „500 вместо отказа“», 20.10.2026).
 *
 * establishments.name — varchar(255), .address — varchar(500); база считает
 * знаки (code points). isLength пропускал знаки вариации U+FE0E/U+FE0F:
 * 255 × «❤️» он считал за 255, база — за 510, и запись падала 22001 → 500.
 * Теперь эти поля считаются как в базе (utils/textLength.js fitsVarchar);
 * тексты отказа — прежние строки (приложение переводит их по самим словам).
 * Описание — text: там isLength остаётся, и длинное описание проходит, как
 * прежде. Сайт заведения — тоже varchar(255), а isURL пропускал до 2084
 * знаков (ревью Phase 3.5 того же дня): теперь и он считается как в базе.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { testEstablishments } from '../fixtures/establishments.js';

const HEART = '❤️'; // U+2764 U+FE0F: два знака для базы, один для isLength
const NAME_REFUSAL = 'Establishment name must be between 1 and 255 characters';
const ADDRESS_REFUSAL = 'Address must be between 1 and 500 characters';
const WEBSITE_REFUSAL = 'Website must be a valid URL';
/** Ссылка ровно из `n` знаков. */
const linkOf = (n) => {
  const head = 'https://example.by/';
  return head + 'a'.repeat(n - head.length);
};

let partner;
let seq = 0;

/** Тело создания карточки — образец из фикстур, своё название на каждый тест. */
const cardBody = (overrides = {}) => {
  seq += 1;
  const { name, ...rest } = testEstablishments[0];
  return { ...rest, name: `${name} ${seq}`, ...overrides };
};

const create = (body) => request(app)
  .post('/api/v1/partner/establishments')
  .set('Authorization', `Bearer ${partner.accessToken}`)
  .send(body);

const update = (id, body) => request(app)
  .put(`/api/v1/partner/establishments/${id}`)
  .set('Authorization', `Bearer ${partner.accessToken}`)
  .send(body);

/** Тексты отказа по полю, по порядку. */
const fieldMessages = (res, field) => (res.body.error?.details ?? [])
  .filter((d) => d.field === field).map((d) => d.message);

const storedLength = async (id, column) => (
  await query(`SELECT char_length(${column}) AS n FROM establishments WHERE id = $1`, [id])).rows[0].n;

beforeAll(async () => {
  await clearAllData();
  partner = await createUserAndGetTokens({
    email: `varchar-length-${Date.now()}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр',
    role: 'partner',
  });
});

afterAll(async () => {
  await clearAllData();
});

describe('создание карточки', () => {
  test('название 255 × «❤️» (510 знаков для базы) — отказ поля, не 500', async () => {
    const res = await create(cardBody({ name: HEART.repeat(255) }));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fieldMessages(res, 'name')).toEqual([NAME_REFUSAL]);
  });

  test('название ровно 255 знаков с «❤️» — принято, в базе 255', async () => {
    const res = await create(cardBody({ name: `${HEART.repeat(127)}я` }));

    expect(res.status).toBe(201);
    expect(await storedLength(res.body.data.establishment.id, 'name')).toBe(255);
  });

  test('адрес 500 × «❤️» (1000 знаков для базы) — отказ поля, не 500', async () => {
    const res = await create(cardBody({ address: HEART.repeat(500) }));

    expect(res.status).toBe(422);
    expect(fieldMessages(res, 'address')).toEqual([ADDRESS_REFUSAL]);
  });

  test('адрес ровно 500 знаков с «❤️» — принят, в базе 500', async () => {
    const res = await create(cardBody({ address: `${HEART.repeat(249)}дд` }));

    expect(res.status).toBe(201);
    expect(await storedLength(res.body.data.establishment.id, 'address')).toBe(500);
  });

  test('название массивом — отказ поля, не 500', async () => {
    const res = await create(cardBody({ name: ['Кафе', 'Бар'] }));

    expect(res.status).toBe(422);
    expect(fieldMessages(res, 'name')).toEqual([NAME_REFUSAL]);
  });

  test('пустые название и адрес — те же по два текста, что прежде', async () => {
    const res = await create(cardBody({ name: '   ', address: '   ' }));

    expect(res.status).toBe(422);
    expect(fieldMessages(res, 'name')).toEqual(['Establishment name is required', NAME_REFUSAL]);
    expect(fieldMessages(res, 'address')).toEqual(['Address is required', ADDRESS_REFUSAL]);
  });

  test('сайт длиннее 255 знаков — отказ поля прежним текстом, не 500', async () => {
    const res = await create(cardBody({ website: linkOf(256) }));

    expect(res.status).toBe(422);
    expect(fieldMessages(res, 'website')).toEqual([WEBSITE_REFUSAL]);
  });

  test('сайт ровно 255 знаков — принят', async () => {
    const res = await create(cardBody({ website: linkOf(255) }));

    expect(res.status).toBe(201);
    expect(await storedLength(res.body.data.establishment.id, 'website')).toBe(255);
  });

  test('описание — text: 1000 × «❤️» (2000 знаков) принимается, как прежде', async () => {
    const res = await create(cardBody({ description: HEART.repeat(1000) }));

    expect(res.status).toBe(201);
    expect(await storedLength(res.body.data.establishment.id, 'description')).toBe(2000);
  });
});

describe('правка карточки', () => {
  let cardId;

  beforeAll(async () => {
    cardId = (await createTestEstablishment(partner.user.id)).id;
    await query("UPDATE establishments SET status = 'draft' WHERE id = $1", [cardId]);
  });

  test('название 255 × «❤️» — отказ поля, название прежнее', async () => {
    const res = await update(cardId, { name: HEART.repeat(255) });

    expect(res.status).toBe(422);
    expect(fieldMessages(res, 'name')).toEqual([NAME_REFUSAL]);
    expect((await query('SELECT name FROM establishments WHERE id = $1', [cardId])).rows[0].name)
      .toBe('Test Restaurant');
  });

  test('адрес 500 × «❤️» — отказ поля', async () => {
    const res = await update(cardId, { address: HEART.repeat(500) });

    expect(res.status).toBe(422);
    expect(fieldMessages(res, 'address')).toEqual([ADDRESS_REFUSAL]);
  });

  test('сайт длиннее 255 знаков — отказ поля; null по-прежнему стирает сайт', async () => {
    const long = await update(cardId, { website: linkOf(256) });
    expect(long.status).toBe(422);
    expect(fieldMessages(long, 'website')).toEqual([WEBSITE_REFUSAL]);

    const cleared = await update(cardId, { website: null });
    expect(cleared.status).toBe(200);
    expect((await query('SELECT website FROM establishments WHERE id = $1', [cardId])).rows[0].website).toBeNull();
  });

  test('название ровно 255 знаков с «❤️» — сохранено', async () => {
    const res = await update(cardId, { name: `${HEART.repeat(127)}ю` });

    expect(res.status).toBe(200);
    expect(await storedLength(cardId, 'name')).toBe(255);
  });
});
