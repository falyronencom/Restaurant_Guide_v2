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
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import { jest } from '@jest/globals';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const NOT_FOUND = 'Акция не найдена — возможно, её уже удалили. Обновите список акций.';
const NOT_OWNED = 'Заведение не найдено или принадлежит другому аккаунту. Обновите список заведений.';
const TITLE_REQUIRED = 'Укажите название акции.';
const IMAGE_TYPE = 'Этот формат не подходит: картинка акции — JPG, PNG, WebP или HEIC.';

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
