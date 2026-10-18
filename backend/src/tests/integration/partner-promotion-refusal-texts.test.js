/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказы партнёру по акциям — по-русски (решение Координатора 13.10.2026,
 * вариант Б).
 *
 * Отказ, который партнёр встречает в обычной работе, — четвёртая акция при трёх
 * действующих: кнопка «Создать» в приложении не прячется. До правки сервер
 * отвечал «Maximum 3 active promotions allowed per establishment», а приложение
 * показывало своё «Ошибка создания акции» без причины. Приложение начнёт
 * показывать текст сервера со следующей сборки (отдельная сессия).
 *
 * Ожидания — литералы утверждённых формулировок; коды и статусы проверяются
 * тоже — их не меняли.
 *
 * 16.10.2026: картинка не того формата и название не строкой (поле дважды в
 * форме, число или объект в JSON) получали 500 «Сбой на сервере» — теперь
 * утверждённые отказы: про форматы картинки и «Укажите название акции.».
 *
 * 18.10.2026: название длиннее 255 знаков, дата, которой нет в календаре,
 * позиция за пределом целого получали 500, а картинка к тому времени уже
 * лежала в облаке; описание массивом сохранялось строкой `{"а","б"}`. Теперь —
 * отказ 422 утверждёнными текстами (слово Координатора 17.10.2026), до облака
 * и до базы.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const NOT_FOUND = 'Акция не найдена — возможно, её уже удалили. Обновите список акций.';
const NOT_OWNED = 'Заведение не найдено или принадлежит другому аккаунту. Обновите список заведений.';
const TITLE_REQUIRED = 'Укажите название акции.';
const IMAGE_TYPE = 'Этот формат не подходит: картинка акции — JPG, PNG, WebP или HEIC.';
const TITLE_TOO_LONG = 'Название акции — не длиннее 255 знаков';
const DATE_INVALID = 'Дата начала или окончания акции указана неверно';
const POSITION_INVALID = 'Позиция акции — целое число от 0 до 1 000 000';
const NOT_TEXT = 'Описание и условия акции должны быть текстом';

let est;
let ownerId;
let ownerToken;
let strangerToken;
let strangerPromotionId;

const insertPromotion = async (establishmentId, title) => {
  const { rows } = await query(
    `INSERT INTO promotions (establishment_id, title, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [establishmentId, title],
  );
  return rows[0].id;
};

const create = (token, fields) => {
  const req = request(app).post('/api/v1/partner/promotions').set('Authorization', `Bearer ${token}`);
  for (const [name, value] of Object.entries(fields)) req.field(name, value);
  return req;
};

beforeAll(async () => {
  await clearAllData();
  const owner = await createUserAndGetTokens({
    email: 'promo-texts-owner@test.com', password: 'Partner123!@#', name: 'Owner', role: 'partner',
  });
  const stranger = await createUserAndGetTokens({
    email: 'promo-texts-stranger@test.com', password: 'Partner123!@#', name: 'Stranger', role: 'partner',
  });
  ownerId = owner.user.id;
  ownerToken = owner.accessToken;
  strangerToken = stranger.accessToken;
  est = await createTestEstablishment(owner.user.id);
  const strangerEst = await createTestEstablishment(stranger.user.id);
  strangerPromotionId = await insertPromotion(strangerEst.id, 'Чужая акция');
});

afterAll(async () => {
  await clearAllData();
});

test('четвёртая акция при трёх действующих — причина и что сделать', async () => {
  await insertPromotion(est.id, 'Первая');
  await insertPromotion(est.id, 'Вторая');
  await insertPromotion(est.id, 'Третья');

  const res = await create(ownerToken, { establishment_id: est.id, title: 'Четвёртая' });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('PROMOTION_LIMIT_EXCEEDED');
  expect(res.body.message).toBe(
    'Одновременно может действовать не больше 3 акций. Удалите одну из текущих, чтобы добавить новую.',
  );
});

describe('Акция не найдена', () => {
  test('правка удалённой акции', async () => {
    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${randomUUID()}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('title', 'Правка');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROMOTION_NOT_FOUND');
    expect(res.body.message).toBe(NOT_FOUND);
  });

  test('удаление удалённой акции', async () => {
    const res = await request(app)
      .delete(`/api/v1/partner/promotions/${randomUUID()}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROMOTION_NOT_FOUND');
    expect(res.body.message).toBe(NOT_FOUND);
  });

  test('чужая акция — тот же текст, что и несуществующая', async () => {
    const res = await request(app)
      .delete(`/api/v1/partner/promotions/${strangerPromotionId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(NOT_FOUND);
  });
});

describe('Чужое заведение', () => {
  test('создать акцию в чужом заведении — 404', async () => {
    const res = await create(strangerToken, { establishment_id: est.id, title: 'Акция чужому' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    expect(res.body.message).toBe(NOT_OWNED);
  });

  test('список акций чужого заведения — 403', async () => {
    const res = await request(app)
      .get(`/api/v1/partner/promotions/establishment/${est.id}`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.message).toBe(NOT_OWNED);
  });
});

describe('Пустые поля формы', () => {
  test('без названия — «Укажите название акции.»', async () => {
    const res = await create(ownerToken, { establishment_id: est.id, title: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Укажите название акции.');
  });

  test('без заведения — «Не выбрано заведение.»', async () => {
    const res = await create(ownerToken, { title: 'Без заведения' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Не выбрано заведение.');
  });
});

/** Отказ — не сбой: в журнале нет «Server error occurred». */
const spyServerErrors = () => {
  const spy = jest.spyOn(logger, 'error');
  return () => spy.mock.calls.filter(([message]) => message === 'Server error occurred');
};

const titleOf = async (promotionId) => (
  await query('SELECT title FROM promotions WHERE id = $1', [promotionId])).rows[0].title;

describe('Картинка не того формата — текст про форматы, 422 (до правки 500)', () => {
  // Как у медиа карточки и временных загрузок: фильтр маршрута отказывает
  // до записи файла; код INVALID_FILE_TYPE — как у отказа сервиса акций.
  const PDF = { filename: 'menu.pdf', contentType: 'application/pdf' };
  const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake\n');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('новая акция', async () => {
    const serverErrors = spyServerErrors();
    const card = await createTestEstablishment(ownerId);

    const res = await create(ownerToken, { establishment_id: card.id, title: 'С картинкой' })
      .attach('image', PDF_BYTES, PDF);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(res.body.message).toBe(IMAGE_TYPE);
    expect(serverErrors()).toEqual([]);
  });

  test('правка акции', async () => {
    const serverErrors = spyServerErrors();
    const id = await insertPromotion(est.id, 'Картинку меняют');

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('image', PDF_BYTES, PDF);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(res.body.message).toBe(IMAGE_TYPE);
    expect(serverErrors()).toEqual([]);
  });

  test('отказывает маршрут — раньше, чем акцию ищут в базе', async () => {
    // Сервис отказал бы тем же текстом, но после поиска акции: по адресу
    // несуществующей он ответил бы 404. 422 здесь — отказ фильтра маршрута.
    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${randomUUID()}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('image', PDF_BYTES, PDF);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });
});

describe('Название не строкой — тот же отказ, что у пустого (до правки 500)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const expectTitleRefused = (res, serverErrors) => {
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe(TITLE_REQUIRED);
    expect(serverErrors()).toEqual([]);
  };

  test('новая акция: поле названия дважды в форме', async () => {
    const serverErrors = spyServerErrors();
    const res = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('establishment_id', est.id)
      .field('title', 'Первое')
      .field('title', 'Второе');

    expectTitleRefused(res, serverErrors);
  });

  test.each([
    ['число', 5],
    ['объект', { ru: 'Скидка' }],
    ['массив', ['Скидка']],
    ['пустой массив', []],
  ])('новая акция, JSON: %s', async (_label, title) => {
    const serverErrors = spyServerErrors();
    const res = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ establishment_id: est.id, title });

    expectTitleRefused(res, serverErrors);
  });

  test('правка: поле названия дважды в форме — название прежнее', async () => {
    const serverErrors = spyServerErrors();
    const id = await insertPromotion(est.id, 'Прежнее название');

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('title', 'Первое')
      .field('title', 'Второе');

    expectTitleRefused(res, serverErrors);
    expect(await titleOf(id)).toBe('Прежнее название');
  });

  test.each([
    ['null', null],
    ['число', 5],
    ['объект', { ru: 'Скидка' }],
    // Строка из пробелов не «не строка», но то же правило, что при создании:
    // до правки она сохранялась пустым названием (200).
    ['одни пробелы', '   '],
  ])('правка, JSON: %s — название прежнее', async (_label, title) => {
    const serverErrors = spyServerErrors();
    const id = await insertPromotion(est.id, 'Прежнее название');

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title });

    expectTitleRefused(res, serverErrors);
    expect(await titleOf(id)).toBe('Прежнее название');
  });

  test('правка без названия — проходит, название прежнее', async () => {
    const id = await insertPromotion(est.id, 'Прежнее название');

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Новое описание' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Прежнее название');
    expect(res.body.data.description).toBe('Новое описание');
  });

  test('правка с названием — пробелы по краям убраны', async () => {
    const id = await insertPromotion(est.id, 'Прежнее название');

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: '  Новое название  ' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Новое название');
  });
});

/** Эмодзи вне базовой плоскости: в JavaScript — две единицы длины, в базе — один знак. */
const EMOJI = String.fromCodePoint(0x1F389);

const promotionsOf = async (establishmentId) => (
  await query('SELECT id FROM promotions WHERE establishment_id = $1', [establishmentId])).rows;

/** Поля акции как их хранит база — даты текстом, без перевода в момент времени. */
const storedOf = async (promotionId) => (await query(
  `SELECT title, description, terms_and_conditions, valid_from::text AS valid_from,
          valid_until::text AS valid_until, position, image_url
     FROM promotions WHERE id = $1`,
  [promotionId],
)).rows[0];

const insertFullPromotion = async (establishmentId) => {
  const { rows } = await query(
    `INSERT INTO promotions (establishment_id, title, description, terms_and_conditions,
                             valid_from, valid_until, position, status)
     VALUES ($1, 'Прежнее название', 'Прежнее описание', 'Прежние условия',
             '2026-10-01', '2026-11-30', 3, 'active') RETURNING id`,
    [establishmentId],
  );
  return rows[0].id;
};

const UNCHANGED = {
  title: 'Прежнее название',
  description: 'Прежнее описание',
  terms_and_conditions: 'Прежние условия',
  valid_from: '2026-10-01',
  valid_until: '2026-11-30',
  position: 3,
  image_url: null,
};

describe('Поля акции — отказ 422 до облака и до базы (до правки 500 или мусор в базе)', () => {
  // Сетевой вызов облака подменён: отказ полей приходит раньше загрузки, и
  // вызова нет вовсе. До правки картинка уходила в облако, а потом база
  // отвечала отказом — 500 и файл без записи.
  let upload;

  beforeEach(() => {
    upload = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => ({
      public_id: `${options.folder}/fields0001`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1759700000/${options.folder}/fields0001.jpg`,
      width: 10,
      height: 10,
      format: 'jpg',
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const expectRefused = (res, text, serverErrors) => {
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe(text);
    expect(serverErrors()).toEqual([]);
  };

  describe('новая акция', () => {
    test.each([
      ['название 256 знаков', { title: 'А'.repeat(256) }, TITLE_TOO_LONG],
      ['название 256 эмодзи', { title: EMOJI.repeat(256) }, TITLE_TOO_LONG],
      ['начало — не дата', { valid_from: 'not-a-date' }, DATE_INVALID],
      ['окончание — тринадцатый месяц', { valid_until: '2026-13-45' }, DATE_INVALID],
      ['окончание — 30 февраля', { valid_until: '2026-02-30' }, DATE_INVALID],
      ['начало — 29 февраля невисокосного года', { valid_from: '2027-02-29' }, DATE_INVALID],
      ['начало — 29 февраля 2100 года (век без кратности 400)', { valid_from: '2100-02-29' }, DATE_INVALID],
      ['окончание — 31 апреля', { valid_until: '2026-04-31' }, DATE_INVALID],
      ['окончание — тринадцатый месяц, первое число', { valid_until: '2026-13-01' }, DATE_INVALID],
      ['начало — нулевой месяц', { valid_from: '2026-00-10' }, DATE_INVALID],
      ['начало — нулевой день', { valid_from: '2026-10-00' }, DATE_INVALID],
      ['начало — нулевой год', { valid_from: '0000-01-01' }, DATE_INVALID],
      // Принятый формат — день, как его шлёт приложение (ГГГГ-ММ-ДД); время
      // к дате база отбрасывает молча, до правки такая дата проходила.
      ['начало — дата со временем', { valid_from: '2026-10-18T10:00:00Z' }, DATE_INVALID],
      ['начало — массив', { valid_from: ['2026-10-01'] }, DATE_INVALID],
      ['окончание — число', { valid_until: 20261231 }, DATE_INVALID],
      ['окончание — объект', { valid_until: { year: 2026 } }, DATE_INVALID],
      ['позиция за пределом целого', { position: '10000000000' }, POSITION_INVALID],
      ['позиция 1 000 001', { position: 1000001 }, POSITION_INVALID],
      ['позиция отрицательная', { position: -1 }, POSITION_INVALID],
      ['позиция дробная', { position: '1.5' }, POSITION_INVALID],
      ['позиция — массив', { position: [1] }, POSITION_INVALID],
      ['описание — массив', { description: ['а', 'б'] }, NOT_TEXT],
      ['описание — число', { description: 5 }, NOT_TEXT],
      ['условия — объект', { terms_and_conditions: { a: 1 } }, NOT_TEXT],
      ['условия — да/нет', { terms_and_conditions: true }, NOT_TEXT],
    ])('JSON: %s', async (_label, fields, text) => {
      const serverErrors = spyServerErrors();
      const card = await createTestEstablishment(ownerId);

      const res = await request(app)
        .post('/api/v1/partner/promotions')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ establishment_id: card.id, title: 'Акция', ...fields });

      expectRefused(res, text, serverErrors);
      expect(await promotionsOf(card.id)).toEqual([]);
    });

    test.each([
      ['описание', 'description', ['Первое', 'Второе'], NOT_TEXT],
      ['дата начала', 'valid_from', ['2026-10-01', '2026-10-02'], DATE_INVALID],
      ['позиция', 'position', ['1', '2'], POSITION_INVALID],
    ])('форма: поле «%s» дважды', async (_label, name, values, text) => {
      const serverErrors = spyServerErrors();
      const card = await createTestEstablishment(ownerId);

      const req = create(ownerToken, { establishment_id: card.id, title: 'Акция' });
      for (const value of values) req.field(name, value);
      const res = await req;

      expectRefused(res, text, serverErrors);
      expect(await promotionsOf(card.id)).toEqual([]);
    });

    test('с картинкой: отказ раньше облака — файл туда не уходит', async () => {
      const serverErrors = spyServerErrors();
      const card = await createTestEstablishment(ownerId);

      const res = await create(ownerToken, { establishment_id: card.id, title: 'А'.repeat(300) })
        .attach('image', Buffer.from('fake-jpeg'), { filename: 'promo.jpg', contentType: 'image/jpeg' });

      expectRefused(res, TITLE_TOO_LONG, serverErrors);
      expect(upload).not.toHaveBeenCalled();
      expect(await promotionsOf(card.id)).toEqual([]);
    });
  });

  describe('правка акции — поля прежние', () => {
    test.each([
      // Четыре пробы автора брифа (PATCH, 16.10.2026: 500, 500, 500, 200 с массивом в базе).
      ['название 300 знаков', { title: 'А'.repeat(300) }, TITLE_TOO_LONG],
      ['начало — не дата', { valid_from: 'not-a-date' }, DATE_INVALID],
      ['окончание 2026-13-45', { valid_until: '2026-13-45' }, DATE_INVALID],
      ['позиция 10000000000', { position: '10000000000' }, POSITION_INVALID],
      ['описание — массив', { description: ['а', 'б'] }, NOT_TEXT],
      // Дату начала не убрать: столбец NOT NULL — до правки 500.
      ['начало — null', { valid_from: null }, DATE_INVALID],
      ['начало — пустая строка', { valid_from: '' }, DATE_INVALID],
      // До правки — 400 с английским текстом базы.
      ['позиция — пустая строка', { position: '' }, POSITION_INVALID],
      ['условия — число', { terms_and_conditions: 5 }, NOT_TEXT],
    ])('JSON: %s', async (_label, fields, text) => {
      const serverErrors = spyServerErrors();
      const id = await insertFullPromotion(est.id);

      const res = await request(app)
        .patch(`/api/v1/partner/promotions/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(fields);

      expectRefused(res, text, serverErrors);
      expect(await storedOf(id)).toEqual(UNCHANGED);
    });

    test('форма: описание дважды', async () => {
      const serverErrors = spyServerErrors();
      const id = await insertFullPromotion(est.id);

      const res = await request(app)
        .patch(`/api/v1/partner/promotions/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('description', 'Первое')
        .field('description', 'Второе');

      expectRefused(res, NOT_TEXT, serverErrors);
      expect(await storedOf(id)).toEqual(UNCHANGED);
    });

    test('с картинкой: отказ раньше облака — файл туда не уходит', async () => {
      const serverErrors = spyServerErrors();
      const id = await insertFullPromotion(est.id);

      const res = await request(app)
        .patch(`/api/v1/partner/promotions/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('valid_until', '2026-13-45')
        .attach('image', Buffer.from('fake-jpeg'), { filename: 'promo.jpg', contentType: 'image/jpeg' });

      expectRefused(res, DATE_INVALID, serverErrors);
      expect(upload).not.toHaveBeenCalled();
      expect(await storedOf(id)).toEqual(UNCHANGED);
    });
  });
});

// Все проходили и до правки, кроме пустого окончания при правке (там 500):
// проверки полей не должны отказывать тому, что база хранит.
describe('Поля акции на границе и пустые — проходят', () => {
  const createdId = async (res) => {
    expect(res.status).toBe(201);
    return res.body.data.id;
  };

  test('название ровно 255 знаков — сохраняется целиком', async () => {
    const card = await createTestEstablishment(ownerId);
    const title = 'Я'.repeat(255);

    const id = await createdId(await create(ownerToken, { establishment_id: card.id, title }));

    expect((await storedOf(id)).title).toBe(title);
  });

  test('название из 255 эмодзи — база считает знаки, а не единицы длины', async () => {
    const card = await createTestEstablishment(ownerId);
    const title = EMOJI.repeat(255);

    const id = await createdId(await create(ownerToken, { establishment_id: card.id, title }));

    expect((await storedOf(id)).title).toBe(title);
  });

  test('255 знаков с пробелами по краям — считается название без них', async () => {
    const card = await createTestEstablishment(ownerId);
    const title = 'Ю'.repeat(255);

    const id = await createdId(await create(ownerToken, { establishment_id: card.id, title: `   ${title}   ` }));

    expect((await storedOf(id)).title).toBe(title);
  });

  test('как шлёт приложение: даты днём, 29 февраля високосного года, позиция 1 000 000', async () => {
    const card = await createTestEstablishment(ownerId);

    const id = await createdId(await create(ownerToken, {
      establishment_id: card.id,
      title: 'Акция',
      description: 'Описание',
      terms_and_conditions: 'Условия',
      valid_from: '2028-02-29',
      valid_until: '2028-12-31',
      position: '1000000',
    }));

    expect(await storedOf(id)).toEqual({
      title: 'Акция',
      description: 'Описание',
      terms_and_conditions: 'Условия',
      valid_from: '2028-02-29',
      valid_until: '2028-12-31',
      position: 1000000,
      image_url: null,
    });
  });

  test('29 февраля 2000 года — високосный: век, кратный 400', async () => {
    const card = await createTestEstablishment(ownerId);

    const id = await createdId(await create(ownerToken, {
      establishment_id: card.id,
      title: 'Акция 2000 года',
      valid_from: '2000-02-29',
    }));

    expect((await storedOf(id)).valid_from).toBe('2000-02-29');
  });

  test('JSON: позиция числом и ноль', async () => {
    const card = await createTestEstablishment(ownerId);
    const send = (position) => request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ establishment_id: card.id, title: `Позиция ${position}`, position });

    expect((await storedOf(await createdId(await send(7)))).position).toBe(7);
    expect((await storedOf(await createdId(await send(0)))).position).toBe(0);
  });

  test('пустые поля формы при создании — значения по умолчанию', async () => {
    const card = await createTestEstablishment(ownerId);
    const today = (await query('SELECT CURRENT_DATE::text AS today')).rows[0].today;

    const id = await createdId(await create(ownerToken, {
      establishment_id: card.id,
      title: 'Акция',
      description: '',
      terms_and_conditions: '',
      valid_from: '',
      valid_until: '',
      position: '',
    }));

    expect(await storedOf(id)).toEqual({
      title: 'Акция',
      description: null,
      terms_and_conditions: null,
      valid_from: today,
      valid_until: null,
      position: 0,
      image_url: null,
    });
  });

  test('JSON при создании: null там, где поле можно не давать, — значения по умолчанию', async () => {
    const card = await createTestEstablishment(ownerId);
    const today = (await query('SELECT CURRENT_DATE::text AS today')).rows[0].today;

    const res = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        establishment_id: card.id,
        title: 'Акция',
        description: null,
        terms_and_conditions: null,
        valid_from: null,
        valid_until: null,
        position: null,
      });

    expect((await storedOf(await createdId(res)))).toEqual({
      title: 'Акция',
      description: null,
      terms_and_conditions: null,
      valid_from: today,
      valid_until: null,
      position: 0,
      image_url: null,
    });
  });

  test('правка как в приложении: строки и даты днём', async () => {
    const id = await insertFullPromotion(est.id);

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('title', 'Новое название')
      .field('description', '')
      .field('valid_from', '2026-10-05')
      .field('valid_until', '2026-12-31');

    expect(res.status).toBe(200);
    expect(await storedOf(id)).toEqual({
      ...UNCHANGED,
      title: 'Новое название',
      description: '',
      valid_from: '2026-10-05',
      valid_until: '2026-12-31',
    });
  });

  // В форме нет null: пустое поле окончания и есть «без срока», как при
  // создании. До правки — 500 (база не читает '' как дату).
  test('правка формой: пустое окончание убирает дату окончания', async () => {
    const id = await insertFullPromotion(est.id);

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('valid_until', '');

    expect(res.status).toBe(200);
    expect(await storedOf(id)).toEqual({ ...UNCHANGED, valid_until: null });
  });

  test('правка, JSON: пустая строка в окончании — то же, что null', async () => {
    const id = await insertFullPromotion(est.id);

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ valid_until: '' });

    expect(res.status).toBe(200);
    expect(await storedOf(id)).toEqual({ ...UNCHANGED, valid_until: null });
  });

  test('правка, JSON: null убирает описание, условия, окончание и позицию', async () => {
    const id = await insertFullPromotion(est.id);

    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: null, terms_and_conditions: null, valid_until: null, position: null });

    expect(res.status).toBe(200);
    expect(await storedOf(id)).toEqual({
      ...UNCHANGED,
      description: null,
      terms_and_conditions: null,
      valid_until: null,
      position: null,
    });
  });
});
