/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказы меню партнёра — по-русски, с 23.11.2026 (нитка Н8, находка 4
 * исследования кабинета партнёра на сайте, часть 1).
 *
 * До правки сервер отвечал по-английски («Menu item not found», «price_byn
 * must be a non-negative number», «No menu media…»), а название длиннее
 * 255 знаков, раздел длиннее 100, пустое название и цена за пределом
 * numeric(10,2) доходили до базы и возвращались 500 «Сбой на сервере»; id не
 * UUID — английским 400 INVALID_FORMAT. Приложение на любую неудачную правку
 * показывает своё «Не удалось сохранить изменения»; сайт показывает текст
 * сервера.
 *
 * Ожидания — литералы формулировок (их утверждает Координатор: правка текста
 * — здесь и в constants/partnerSectionRefusals.js вместе); коды и статусы —
 * тоже. Что отказ ничего не записал, проверяется по строке в базе.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, clearTableTree, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

const NOT_FOUND = 'Позиция не найдена — возможно, меню распознано заново.';
const NO_CHANGES = 'Нет изменений для сохранения.';
const PRICE_INVALID = 'Цена должна быть числом не меньше нуля.';
const PRICE_TOO_HIGH = 'Цена слишком большая.';
const NAME_REQUIRED = 'Укажите название позиции.';
const NAME_TOO_LONG = 'Название позиции — не длиннее 255 знаков.';
const SECTION_TOO_LONG = 'Раздел меню — не длиннее 100 знаков.';
const NO_MENU_FILES = 'Сначала добавьте фото меню или PDF.';
const NOTHING_TO_RECOGNIZE_TEXT =
  'Все файлы меню уже распознаны. Чтобы распознать файл заново, удалите его и загрузите ещё раз.';
// The card's own text (ESTABLISHMENT_REFUSALS.notOwner, approved 15.10.2026):
// the menu routes answered an id not written as the database writes it with
// it already; from 23.11.2026 a foreign card too.
const NOT_OWNER =
  'Нет доступа к этому заведению — возможно, оно удалено или принадлежит другой учётной записи. Обновите список заведений.';

async function createPartner() {
  return createUserAndGetTokens({
    email: `menu-texts-${randomUUID()}@test.com`,
    phone: null,
    password: 'Partner123!@#',
    name: 'Menu Texts Partner',
    role: 'partner',
    authMethod: 'email',
  });
}

async function createEstablishmentFor(partnerId) {
  const id = randomUUID();
  await query(
    `INSERT INTO establishments
       (id, partner_id, name, slug, description, city, address, latitude, longitude,
        categories, cuisines, price_range, working_hours, status, created_at, updated_at)
     VALUES ($1, $2, 'Menu Texts Estab', gen_random_uuid()::text, 'desc', 'Минск', 'ул. Тестовая 1',
             53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$',
             '{}'::jsonb, 'active', NOW(), NOW())`,
    [id, partnerId],
  );
  return id;
}

async function seedMenuFile(establishmentId) {
  const res = await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
     RETURNING id`,
    [establishmentId],
  );
  return res.rows[0].id;
}

/** A line with a flag on it: a refused edit must leave the flag as well. */
async function seedItem(establishmentId, mediaId, { isHiddenByAdmin = false } = {}) {
  const res = await query(
    `INSERT INTO menu_items
       (establishment_id, media_id, item_name, price_byn, category_raw, sanity_flag,
        is_hidden_by_admin, position)
     VALUES ($1, $2, 'Латте', 7, 'Кофе', '{"reason": "low_confidence", "details": {}}'::jsonb, $3, 0)
     RETURNING id`,
    [establishmentId, mediaId, isHiddenByAdmin],
  );
  return res.rows[0].id;
}

const stored = async (itemId) => (await query(
  'SELECT item_name, price_byn, category_raw, sanity_flag FROM menu_items WHERE id = $1',
  [itemId],
)).rows[0];

const SEEDED = {
  item_name: 'Латте',
  price_byn: '7.00',
  category_raw: 'Кофе',
  sanity_flag: { reason: 'low_confidence', details: {} },
};

const patch = (partner, itemId, body) => request(app)
  .patch(`/api/v1/partner/menu-items/${itemId}`)
  .set('Authorization', `Bearer ${partner.accessToken}`)
  .send(body);

let partner;
let estId;
let mediaId;

beforeAll(async () => {
  await clearTableTree('establishments');
  partner = await createPartner();
  estId = await createEstablishmentFor(partner.user.id);
  mediaId = await seedMenuFile(estId);
});

afterAll(async () => {
  await clearAllData();
});

describe('PATCH /api/v1/partner/menu-items/:id — отказ с текстом партнёра, строка не меняется', () => {
  test.each([
    ['пустое название', 422, 'VALIDATION_ERROR', { item_name: '' }, NAME_REQUIRED],
    ['название из одних пробелов', 422, 'VALIDATION_ERROR', { item_name: '   ' }, NAME_REQUIRED],
    // null дошёл бы до NOT NULL колонки — 500 до правки.
    ['название null', 422, 'VALIDATION_ERROR', { item_name: null }, NAME_REQUIRED],
    ['название не текстом', 422, 'VALIDATION_ERROR', { item_name: 42 }, NAME_REQUIRED],
    ['название в 256 знаков', 422, 'VALIDATION_ERROR', { item_name: 'а'.repeat(256) }, NAME_TOO_LONG],
    ['раздел в 101 знак', 422, 'VALIDATION_ERROR', { category_raw: 'б'.repeat(101) }, SECTION_TOO_LONG],
    // Список записался бы в колонку литералом {"Супы"}.
    ['раздел списком', 422, 'VALIDATION_ERROR', { category_raw: ['Супы'] }, SECTION_TOO_LONG],
    ['цена меньше нуля', 422, 'INVALID_PRICE', { price_byn: -1 }, PRICE_INVALID],
    ['цена словом', 422, 'INVALID_PRICE', { price_byn: 'abc' }, PRICE_INVALID],
    // Number('') — 0: до правки строка доходила до базы и та отвечала английским 400.
    ['цена пустой строкой', 422, 'INVALID_PRICE', { price_byn: '' }, PRICE_INVALID],
    ['цена с запятой строкой', 422, 'INVALID_PRICE', { price_byn: '12,5' }, PRICE_INVALID],
    ['цена флагом', 422, 'INVALID_PRICE', { price_byn: true }, PRICE_INVALID],
    ['цена списком', 422, 'INVALID_PRICE', { price_byn: [5] }, PRICE_INVALID],
    ['цена в сто миллионов', 422, 'INVALID_PRICE', { price_byn: 100000000 }, PRICE_TOO_HIGH],
    // numeric(10,2) округлит её до 100 000 000,00 — а это уже не помещается.
    ['цена, что округлится до ста миллионов', 422, 'INVALID_PRICE', { price_byn: 99999999.995 }, PRICE_TOO_HIGH],
    ['ни одного поля', 400, 'NO_FIELDS_TO_UPDATE', {}, NO_CHANGES],
    ['только поля, которых партнёр не правит', 400, 'NO_FIELDS_TO_UPDATE', { sanity_flag: null, is_hidden_by_admin: true }, NO_CHANGES],
  ])('%s → %i %s', async (_case, status, code, body, text) => {
    const itemId = await seedItem(estId, mediaId);

    const res = await patch(partner, itemId, body);

    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(code);
    expect(res.body.message).toBe(text);
    expect(await stored(itemId)).toEqual(SEEDED);
  });

  test('с двумя неверными полями отвечает первое по форме приложения — название', async () => {
    const itemId = await seedItem(estId, mediaId);

    const res = await patch(partner, itemId, { item_name: '', price_byn: -1, category_raw: 'б'.repeat(101) });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(NAME_REQUIRED);
    expect(await stored(itemId)).toEqual(SEEDED);
  });
});

describe('PATCH /api/v1/partner/menu-items/:id — на границе принимается, как запишет база', () => {
  test.each([
    ['название ровно в 255 знаков', { item_name: 'а'.repeat(255) }, { item_name: 'а'.repeat(255) }],
    // 255 знаков — 510 единиц UTF-16: база считает знаки, не единицы.
    ['название из 255 эмодзи', { item_name: '🍕'.repeat(255) }, { item_name: '🍕'.repeat(255) }],
    ['название с пробелами вокруг — пишется без них', { item_name: '  Латте на овсяном  ' }, { item_name: 'Латте на овсяном' }],
    ['раздел ровно в 100 знаков', { category_raw: 'б'.repeat(100) }, { category_raw: 'б'.repeat(100) }],
    ['раздел с пробелами вокруг — пишется без них', { category_raw: '  Супы  ' }, { category_raw: 'Супы' }],
    // Приложение шлёт пустую строку, когда раздел стёрт.
    ['пустой раздел', { category_raw: '' }, { category_raw: '' }],
    ['раздел null', { category_raw: null }, { category_raw: null }],
    ['цена null — цена снята', { price_byn: null }, { price_byn: null }],
    ['цена ноль', { price_byn: 0 }, { price_byn: '0.00' }],
    ['цена 99 999 999,99', { price_byn: 99999999.99 }, { price_byn: '99999999.99' }],
    ['цена, что округлится до 99 999 999,99', { price_byn: 99999999.994 }, { price_byn: '99999999.99' }],
    ['цена строкой с точкой', { price_byn: '12.50' }, { price_byn: '12.50' }],
  ])('%s → 200', async (_case, body, change) => {
    const itemId = await seedItem(estId, mediaId);

    const res = await patch(partner, itemId, body);

    expect(res.status).toBe(200);
    // Правка партнёра снимает флаг, как прежде.
    expect(await stored(itemId)).toEqual({ ...SEEDED, sanity_flag: null, ...change });
  });
});

describe('PATCH /api/v1/partner/menu-items/:id — позиции нет: 404 MENU_ITEM_NOT_FOUND с текстом партнёра', () => {
  const notFound = async (path, actor = partner) => {
    const res = await request(app)
      .patch(`/api/v1/partner/menu-items/${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .send({ price_byn: 9 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
    expect(res.body.message).toBe(NOT_FOUND);
  };

  test('такой позиции нет', async () => {
    await notFound(randomUUID());
  });

  test('позиция другого партнёра — тот же ответ, позиция не тронута', async () => {
    const itemId = await seedItem(estId, mediaId);
    await notFound(itemId, await createPartner());
    expect(await stored(itemId)).toEqual(SEEDED);
  });

  test('позиция, скрытая модератором, — тот же ответ, позиция не тронута', async () => {
    const itemId = await seedItem(estId, mediaId, { isHiddenByAdmin: true });
    await notFound(itemId);
    expect(await stored(itemId)).toEqual(SEEDED);
  });

  // До правки такие id доходили до базы: не UUID — английский 400
  // INVALID_FORMAT, заглавные и скобки правили строку.
  test.each([
    ['заглавными', (id) => id.toUpperCase()],
    ['в фигурных скобках', (id) => encodeURIComponent(`{${id}}`)],
    ['не UUID', () => 'abc'],
  ])('id %s — тот же ответ, позиция не тронута', async (_case, spell) => {
    const itemId = await seedItem(estId, mediaId);
    await notFound(spell(itemId));
    expect(await stored(itemId)).toEqual(SEEDED);
  });
});

describe('меню и перезапуск распознавания — отказы карточки и файлов', () => {
  test.each([
    ['список меню', 'get', 'menu-items'],
    ['перезапуск распознавания', 'post', 'retry-ocr'],
  ])('%s чужой карточки — 404 ESTABLISHMENT_NOT_FOUND с текстом карточки', async (_case, method, tail) => {
    const res = await request(app)[method](`/api/v1/partner/establishments/${estId}/${tail}`)
      .set('Authorization', `Bearer ${(await createPartner()).accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    expect(res.body.message).toBe(NOT_OWNER);
  });

  const retry = (actor, cardId) => request(app)
    .post(`/api/v1/partner/establishments/${cardId}/retry-ocr`)
    .set('Authorization', `Bearer ${actor.accessToken}`);

  test('у карточки нет файлов меню — 400 NO_PDF_MENUS', async () => {
    const owner = await createPartner();
    const cardId = await createEstablishmentFor(owner.user.id);

    const res = await retry(owner, cardId);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_PDF_MENUS');
    expect(res.body.message).toBe(NO_MENU_FILES);
  });

  test('каждый файл меню распознан — 409 NOTHING_TO_RECOGNIZE', async () => {
    const owner = await createPartner();
    const cardId = await createEstablishmentFor(owner.user.id);
    const fileId = await seedMenuFile(cardId);
    await query(
      "INSERT INTO ocr_jobs (establishment_id, media_id, status) VALUES ($1, $2, 'done')",
      [cardId, fileId],
    );

    const res = await retry(owner, cardId);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOTHING_TO_RECOGNIZE');
    expect(res.body.message).toBe(NOTHING_TO_RECOGNIZE_TEXT);
  });
});
