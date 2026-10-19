/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Кухня необязательна для бара и клуба — решение Координатора В5 (17.10.2026);
 * сверка находок тестировщика с сайтом, 18.10, пункт 34.
 *
 * Весь путь партнёра на живой базе: проверка запроса, сервис, запись.
 * Создание, правка и отправка на модерацию. Карточка, у которой есть и бар,
 * и ресторан, живёт по правилу ресторана: кухня обязательна.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import { testEstablishments } from '../fixtures/establishments.js';

let partnerToken;

const base = () => {
  const { cuisines: _omit, ...rest } = testEstablishments[0];
  return rest;
};

const create = (body) => request(app)
  .post('/api/v1/partner/establishments')
  .set('Authorization', `Bearer ${partnerToken}`)
  .send(body);

const update = (id, body) => request(app)
  .put(`/api/v1/partner/establishments/${id}`)
  .set('Authorization', `Bearer ${partnerToken}`)
  .send(body);

const submit = (id) => request(app)
  .post(`/api/v1/partner/establishments/${id}/submit`)
  .set('Authorization', `Bearer ${partnerToken}`);

const storedCuisines = async (id) => {
  const result = await query('SELECT cuisines FROM establishments WHERE id = $1', [id]);
  return result.rows[0].cuisines;
};

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerToken = partner.accessToken;
});

beforeEach(async () => {
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

describe('создание', () => {
  test('бар с пустым списком кухонь принимается, в базе пустой список', async () => {
    const response = await create({ ...base(), name: 'Бар без кухни', categories: ['Бар'], cuisines: [] })
      .expect(201);

    const id = response.body.data.establishment.id;
    expect(response.body.data.establishment.cuisines).toEqual([]);
    expect(await storedCuisines(id)).toEqual([]);
  });

  test('клуб без поля кухонь принимается, в базе пустой список', async () => {
    const response = await create({ ...base(), name: 'Клуб без кухни', categories: ['Клуб'] })
      .expect(201);

    expect(await storedCuisines(response.body.data.establishment.id)).toEqual([]);
  });

  test('бар и клуб вместе без кухни принимаются', async () => {
    await create({ ...base(), name: 'Бар-клуб', categories: ['Бар', 'Клуб'], cuisines: [] })
      .expect(201);
  });

  test('бар с кухней по-прежнему принимается', async () => {
    const response = await create({ ...base(), name: 'Бар с кухней', categories: ['Бар'], cuisines: ['Европейская'] })
      .expect(201);

    expect(response.body.data.establishment.cuisines).toEqual(['Европейская']);
  });

  test('ресторан без кухни — отказ', async () => {
    const response = await create({ ...base(), name: 'Ресторан без кухни', categories: ['Ресторан'], cuisines: [] })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('ресторан без поля кухонь — отказ', async () => {
    await create({ ...base(), name: 'Ресторан без поля', categories: ['Ресторан'] })
      .expect(422);
  });

  test('бар и ресторан без кухни — отказ: правило ресторана сильнее', async () => {
    await create({ ...base(), name: 'Бар-ресторан', categories: ['Бар', 'Ресторан'], cuisines: [] })
      .expect(422);
  });

  test('паб без кухни — отказ: паб остаётся с кухней (Ш17)', async () => {
    await create({ ...base(), name: 'Паб', categories: ['Паб'], cuisines: [] })
      .expect(422);
  });

  // Ш17 (19.10.2026): кальянная, боулинг, караоке и бильярд — тоже без кухни.
  test.each([
    ['Кальянная'],
    ['Боулинг'],
    ['Караоке'],
    ['Бильярд'],
  ])('%s без кухни принимается, в базе пустой список', async (category) => {
    const response = await create({ ...base(), name: `${category} без кухни`, categories: [category], cuisines: [] })
      .expect(201);

    expect(await storedCuisines(response.body.data.establishment.id)).toEqual([]);
  });

  test('боулинг и паб без кухни — отказ: правило паба сильнее', async () => {
    await create({ ...base(), name: 'Боулинг-паб', categories: ['Боулинг', 'Паб'], cuisines: [] })
      .expect(422);
  });

  test('кальянная и бар без кухни принимаются', async () => {
    await create({ ...base(), name: 'Кальянная-бар', categories: ['Кальянная', 'Бар'], cuisines: [] })
      .expect(201);
  });

  test('бар с четырьмя кухнями — отказ: больше трёх нельзя никому', async () => {
    await create({
      ...base(),
      name: 'Бар четыре кухни',
      categories: ['Бар'],
      cuisines: ['Народная', 'Европейская', 'Азиатская', 'Итальянская'],
    }).expect(422);
  });
});

describe('правка', () => {
  const createBar = async () => {
    const response = await create({ ...base(), name: 'Бар', categories: ['Бар'], cuisines: [] }).expect(201);
    return response.body.data.establishment.id;
  };

  const createRestaurant = async () => {
    const response = await create({ ...base(), name: 'Ресторан', categories: ['Ресторан'], cuisines: ['Европейская'] })
      .expect(201);
    return response.body.data.establishment.id;
  };

  test('бар снимает кухню — принимается', async () => {
    const response = await create({ ...base(), name: 'Бар', categories: ['Бар'], cuisines: ['Европейская'] })
      .expect(201);
    const id = response.body.data.establishment.id;

    await update(id, { cuisines: [] }).expect(200);
    expect(await storedCuisines(id)).toEqual([]);
  });

  test('бар без кухни сохраняет всю форму (как сайт) — принимается', async () => {
    const id = await createBar();
    await update(id, { categories: ['Бар'], cuisines: [], description: 'Коктейли' }).expect(200);
  });

  test('ресторан снимает кухню (категории не присланы) — отказ сервиса', async () => {
    const id = await createRestaurant();

    const response = await update(id, { cuisines: [] }).expect(422);
    expect(response.body.error.code).toBe('INVALID_CUISINES_LENGTH');
    expect(await storedCuisines(id)).toEqual(['Европейская']);
  });

  test('ресторан снимает кухню вместе с категориями — отказ проверки запроса', async () => {
    const id = await createRestaurant();

    const response = await update(id, { categories: ['Ресторан'], cuisines: [] }).expect(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('бар без кухни становится рестораном, кухня не выбрана — отказ', async () => {
    const id = await createBar();

    const response = await update(id, { categories: ['Ресторан'] }).expect(422);
    expect(response.body.error.code).toBe('INVALID_CUISINES_LENGTH');
  });

  test('бар без кухни добавляет ресторан и кухню — принимается', async () => {
    const id = await createBar();

    await update(id, { categories: ['Бар', 'Ресторан'], cuisines: ['Европейская'] }).expect(200);
  });

  test('ресторан становится баром и снимает кухню — принимается', async () => {
    const id = await createRestaurant();

    await update(id, { categories: ['Бар'], cuisines: [] }).expect(200);
    expect(await storedCuisines(id)).toEqual([]);
  });
});

describe('отправка на модерацию', () => {
  test('караоке без кухни уходит на модерацию', async () => {
    const response = await create({ ...base(), name: 'Караоке', categories: ['Караоке'], cuisines: [] }).expect(201);

    const submitted = await submit(response.body.data.establishment.id).expect(200);
    expect(submitted.body.data.establishment.status).toBe('pending');
  });

  test('бар без кухни уходит на модерацию', async () => {
    const response = await create({ ...base(), name: 'Бар', categories: ['Бар'], cuisines: [] }).expect(201);

    const submitted = await submit(response.body.data.establishment.id).expect(200);
    expect(submitted.body.data.establishment.status).toBe('pending');
  });

  test('ресторан с пустой кухней в базе — отказ «заполните: кухню»', async () => {
    const response = await create({ ...base(), name: 'Ресторан', categories: ['Ресторан'], cuisines: ['Европейская'] })
      .expect(201);
    const id = response.body.data.establishment.id;
    // Так карточку не создать через API; так она могла остаться от старых данных.
    await query("UPDATE establishments SET cuisines = '{}' WHERE id = $1", [id]);

    const refused = await submit(id).expect(400);
    expect(refused.body.error.code).toBe('INCOMPLETE_ESTABLISHMENT');
    expect(JSON.stringify(refused.body)).toContain('кухню');
  });
});
