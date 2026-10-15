/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Что читает партнёр, когда сервер отказывает ему на действиях с карточкой
 * (решение Координатора 13.10.2026).
 *
 * Приложение показывает текст сервера как есть — и в сборках, которые уже
 * стоят у партнёров: iPhone до запуска не пересобирается. Тексты отказов были
 * английскими («You already have an establishment with this name»,
 * «Coordinates (54.2, 27.5) are outside Минск city bounds…»), и партнёр читал
 * их на русском экране. Сайт переводит отказы по коду своей картой; коды не
 * меняются — на них держатся сайт и тесты.
 *
 * Ожидаемые тексты — литералы, утверждённые Координатором: их читает партнёр,
 * и сверять их с кодом, который их же и производит, значило бы ничего не
 * проверить. Запросы идут настоящими маршрутами партнёра.
 *
 * Вторая половина — правка карточки, чья точка лежит за рамкой своего города
 * (такие приходят импортом или правкой модератора). Мастер правки в приложении
 * пересылает сохранённые город и точку при каждом сохранении, и сервер
 * отказывал в ЛЮБОЙ правке такой карточки — даже фото или описания. Теперь
 * точка проверяется, только если город или точка действительно меняются.
 * Тело правки собрано по `PartnerRegistration.toJson()` приложения
 * (mobile/lib/models/partner_registration.dart) из ответа GET карточки — так,
 * как приложение получает карточку и отсылает её обратно.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { testEstablishments } from '../fixtures/establishments.js';

// Утверждены Координатором 13.10.2026.
const OUTSIDE_CITY = 'Точка на карте не попадает в выбранный город. Проверьте город и адрес или передвиньте точку на карте. Если заведение за городом, напишите в поддержку.';
const DUPLICATE_NAME = 'У вас уже есть заведение с таким названием — оно в списке ваших заведений. Если это второй адрес, добавьте к названию улицу или район.';
const PAUSED_EDIT = 'Показ заведения приостановлен. Чтобы изменить карточку, сначала возобновите показ.';
const ALREADY_SUBMITTED = 'Эта карточка уже на модерации или опубликована — отправлять её не нужно.';
const PAUSE_NOT_PUBLISHED = 'Приостановить можно только опубликованное заведение.';
const RESUME_NOT_PAUSED = 'Возобновить можно только приостановленное заведение.';
// Утверждены Координатором 15.10.2026: «нет доступа» получает и карточка,
// которой уже нет (проверка владельца не отличает её от чужой).
const NOT_OWNER = 'Нет доступа к этому заведению — возможно, оно удалено или принадлежит другому аккаунту. Обновите список заведений.';
const NOT_FOUND = 'Заведение не найдено — возможно, оно удалено. Обновите список заведений.';
// Утверждены Координатором 15.10.2026 (форма приложения их не допускает).
const UNKNOWN_CATEGORY = 'Такой категории нет в списке. Выберите категорию заново.';
const INTERIOR_LIMIT = 'Можно добавить не больше 30 фото интерьера.';

let accountSeq = 0;
const newPartner = async () => {
  accountSeq += 1;
  return createUserAndGetTokens({
    email: `refusal-texts-${Date.now()}-${accountSeq}@test.com`,
    password: 'Partner123!@#',
    name: 'Партнёр',
    role: 'partner',
  });
};

/** Карточка партнёра с заданными полями — минуя маршруты, как импорт или модератор. */
const card = async (owner, { status = 'active', name, city, latitude, longitude, notes } = {}) => {
  const est = await createTestEstablishment(owner.user.id);
  await query(
    `UPDATE establishments
        SET status = $2,
            name = COALESCE($3, name),
            city = COALESCE($4, city),
            latitude = COALESCE($5, latitude),
            longitude = COALESCE($6, longitude),
            moderation_notes = $7
      WHERE id = $1`,
    [est.id, status, name ?? null, city ?? null, latitude ?? null, longitude ?? null, notes ?? null],
  );
  return est.id;
};

const as = (who) => ({
  create: (body) => request(app).post('/api/v1/partner/establishments')
    .set('Authorization', `Bearer ${who.accessToken}`).send(body),
  get: (id) => request(app).get(`/api/v1/partner/establishments/${id}`)
    .set('Authorization', `Bearer ${who.accessToken}`),
  update: (id, body) => request(app).put(`/api/v1/partner/establishments/${id}`)
    .set('Authorization', `Bearer ${who.accessToken}`).send(body),
  submit: (id) => request(app).post(`/api/v1/partner/establishments/${id}/submit`)
    .set('Authorization', `Bearer ${who.accessToken}`),
  suspend: (id) => request(app).post(`/api/v1/partner/establishments/${id}/suspend`)
    .set('Authorization', `Bearer ${who.accessToken}`),
  resume: (id) => request(app).post(`/api/v1/partner/establishments/${id}/resume`)
    .set('Authorization', `Bearer ${who.accessToken}`),
  delete: (id) => request(app).delete(`/api/v1/partner/establishments/${id}`)
    .set('Authorization', `Bearer ${who.accessToken}`),
});

/** Отказ: статус, код и текст, который увидит партнёр. */
const refusal = (res) => ({ http: res.status, code: res.body.error?.code, message: res.body.message });

/**
 * Тело правки, как его шлёт мастер приложения: `PartnerRegistration.toJson()`
 * над карточкой из GET — название, описание, категории, кухни, город, адрес,
 * точка, часы работы, телефон и цена, если есть; поверх — правка партнёра.
 */
const appEditBody = (est, changes = {}) => ({
  name: est.name,
  ...(est.description != null ? { description: est.description } : {}),
  categories: est.categories,
  cuisines: est.cuisines,
  city: est.city,
  address: est.address,
  latitude: est.latitude,
  longitude: est.longitude,
  working_hours: est.working_hours,
  ...(est.phone ? { phone: est.phone } : {}),
  ...(est.price_range ? { price_range: est.price_range } : {}),
  ...changes,
});

const stored = async (id) => (await query(
  'SELECT description, city, latitude::float8 AS latitude, longitude::float8 AS longitude FROM establishments WHERE id = $1',
  [id],
)).rows[0];

let partner;
let otherPartner;

beforeAll(async () => {
  await clearAllData();
  partner = await newPartner();
  otherPartner = await newPartner();
});

afterAll(async () => {
  await clearAllData();
});

describe('Отказы по карточке — тексты, которые читает партнёр', () => {
  it('создание: точка не в выбранном городе', async () => {
    const res = await as(partner).create({
      ...testEstablishments[0], name: 'Точка за Минском', city: 'Минск', latitude: 54.3, longitude: 27.5,
    });
    expect(refusal(res)).toEqual({ http: 422, code: 'COORDINATES_CITY_MISMATCH', message: OUTSIDE_CITY });
  });

  it('создание: заведение с таким названием у партнёра уже есть', async () => {
    const first = await as(partner).create({ ...testEstablishments[0], name: 'Кофейня Зерно' });
    expect(first.status).toBe(201);

    const second = await as(partner).create({ ...testEstablishments[0], name: 'Кофейня Зерно' });
    expect(refusal(second)).toEqual({ http: 409, code: 'DUPLICATE_ESTABLISHMENT', message: DUPLICATE_NAME });
  });

  it('правка: переименование в название другой своей карточки', async () => {
    await card(partner, { name: 'Зерно' });
    const second = await card(partner, { name: 'Зерно на Немиге' });

    const res = await as(partner).update(second, { name: 'Зерно' });
    expect(refusal(res)).toEqual({ http: 409, code: 'DUPLICATE_ESTABLISHMENT', message: DUPLICATE_NAME });
  });

  it('правка карточки на паузе партнёра', async () => {
    const id = await card(partner, { status: 'suspended' });

    const res = await as(partner).update(id, { description: 'Новое описание' });
    expect(refusal(res)).toEqual({ http: 403, code: 'ESTABLISHMENT_SUSPENDED', message: PAUSED_EDIT });
  });

  it('отправка на модерацию карточки, которая уже на модерации или опубликована', async () => {
    const pending = await card(partner, { status: 'pending' });
    const active = await card(partner, { status: 'active' });

    expect(refusal(await as(partner).submit(pending)))
      .toEqual({ http: 400, code: 'INVALID_STATUS_FOR_SUBMISSION', message: ALREADY_SUBMITTED });
    expect(refusal(await as(partner).submit(active)))
      .toEqual({ http: 400, code: 'INVALID_STATUS_FOR_SUBMISSION', message: ALREADY_SUBMITTED });
  });

  it('пауза неопубликованной карточки и возобновление непостановленной на паузу', async () => {
    const draft = await card(partner, { status: 'draft' });
    const active = await card(partner, { status: 'active' });

    expect(refusal(await as(partner).suspend(draft)))
      .toEqual({ http: 400, code: 'INVALID_STATUS_TRANSITION', message: PAUSE_NOT_PUBLISHED });
    expect(refusal(await as(partner).resume(active)))
      .toEqual({ http: 400, code: 'INVALID_STATUS_TRANSITION', message: RESUME_NOT_PAUSED });
  });

  it('чужая карточка: правка, отправка, пауза, возобновление и удаление — «нет доступа»', async () => {
    const foreign = await card(otherPartner, { status: 'active' });
    const pausedForeign = await card(otherPartner, { status: 'suspended' });
    const draftForeign = await card(otherPartner, { status: 'draft' });

    const outcomes = {
      update: refusal(await as(partner).update(foreign, { description: 'чужое' })),
      submit: refusal(await as(partner).submit(draftForeign)),
      suspend: refusal(await as(partner).suspend(foreign)),
      resume: refusal(await as(partner).resume(pausedForeign)),
      delete: refusal(await as(partner).delete(draftForeign)),
    };
    const expected = { http: 403, code: 'FORBIDDEN', message: NOT_OWNER };
    expect(outcomes).toEqual({
      update: expected, submit: expected, suspend: expected, resume: expected, delete: expected,
    });
  });

  it('карточки уже нет (старый экран после удаления): правка — тот же «нет доступа», открытие — «не найдено»', async () => {
    const id = await card(partner, { status: 'draft' });
    await query('DELETE FROM establishments WHERE id = $1', [id]);

    expect(refusal(await as(partner).update(id, { description: 'поздно' })))
      .toEqual({ http: 403, code: 'FORBIDDEN', message: NOT_OWNER });
    expect(refusal(await as(partner).get(id)))
      .toEqual({ http: 404, code: 'ESTABLISHMENT_NOT_FOUND', message: NOT_FOUND });
  });

  it('создание с категорией не из списка: строка поля — по-русски', async () => {
    // «Чайная» — правдоподобная категория, которой в каноне нет (constants/establishmentVocab.js).
    const res = await as(partner).create({ ...testEstablishments[0], name: 'Чайная', categories: ['Чайная'] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'categories', message: UNKNOWN_CATEGORY })]),
    );
  });

  it('создание с 31 фото интерьера: «можно добавить не больше 30»', async () => {
    const photos = Array.from({ length: 31 }, (_, i) => `https://res.cloudinary.com/test/image/upload/v1/establishments/temp/x/p${i}`);
    const res = await as(partner).create({ ...testEstablishments[0], name: 'Много фото', interior_photos: photos });
    expect(refusal(res)).toEqual({ http: 403, code: 'MEDIA_LIMIT_EXCEEDED', message: INTERIOR_LIMIT });
  });
});

describe('Правка карточки, чья точка за рамкой своего города (решение Координатора 13.10.2026)', () => {
  // Минск: рамка 53.75–54.10 × 27.30–27.85; точка 54.20, 27.50 — севернее.
  const OUTSIDE_MINSK = { city: 'Минск', latitude: 54.2, longitude: 27.5 };

  /** Карточка из GET — то, что приложение получает перед правкой. */
  const loaded = async (id) => {
    const res = await as(partner).get(id);
    expect(res.status).toBe(200);
    return res.body.data.establishment;
  };

  it('правка описания при тех же городе и точке сохраняется', async () => {
    const id = await card(partner, OUTSIDE_MINSK);
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, { description: 'Новое описание' }));
    expect(res.status).toBe(200);
    expect(await stored(id)).toEqual({
      description: 'Новое описание', city: 'Минск', latitude: 54.2, longitude: 27.5,
    });
  });

  it('та же точка, присланная строками, — тоже не изменение', async () => {
    const id = await card(partner, OUTSIDE_MINSK);
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, {
      latitude: String(est.latitude), longitude: String(est.longitude), description: 'Строками',
    }));
    expect(res.status).toBe(200);
    expect((await stored(id)).description).toBe('Строками');
  });

  it('число с хвостом («54.2abc») — не та же точка: проверяется и получает отказ, в базу не пишется', async () => {
    // Приложение так не шлёт; сторож того, что «та же точка» значит ровно то
    // же число: иначе такое значение сошло бы за прежнее и ушло бы в базу.
    const id = await card(partner, OUTSIDE_MINSK);
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, { latitude: '54.2abc', description: 'С хвостом' }));
    expect(refusal(res)).toEqual({ http: 422, code: 'COORDINATES_CITY_MISMATCH', message: OUTSIDE_CITY });
    expect(await stored(id)).toEqual({
      description: 'Test Description', city: 'Минск', latitude: 54.2, longitude: 27.5,
    });
  });

  it('Могилев и Могилёв — один город: смена написания точку не проверяет', async () => {
    // Могилёв: рамка 53.82–54.00 × 30.20–30.50; точка 54.10 — севернее.
    const id = await card(partner, { city: 'Могилев', latitude: 54.1, longitude: 30.3 });
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, { city: 'Могилёв', description: 'Через ё' }));
    expect(res.status).toBe(200);
    expect(await stored(id)).toMatchObject({ city: 'Могилёв', description: 'Через ё' });
  });

  it('точка сдвинута, но снова за рамкой — отказ, карточка не тронута', async () => {
    const id = await card(partner, OUTSIDE_MINSK);
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, { latitude: 54.25, description: 'Не сохранится' }));
    expect(refusal(res)).toEqual({ http: 422, code: 'COORDINATES_CITY_MISMATCH', message: OUTSIDE_CITY });
    expect(await stored(id)).toEqual({
      description: 'Test Description', city: 'Минск', latitude: 54.2, longitude: 27.5,
    });
  });

  it('точку в городе сдвинули за рамку только по долготе — отказ', async () => {
    const id = await card(partner, { city: 'Минск', latitude: 53.9, longitude: 27.5 });
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, { longitude: 27.95 }));
    expect(refusal(res)).toEqual({ http: 422, code: 'COORDINATES_CITY_MISMATCH', message: OUTSIDE_CITY });
  });

  it('сменился город, точка прежняя — точка проверяется по новому городу', async () => {
    const id = await card(partner, OUTSIDE_MINSK);
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, { city: 'Гродно' }));
    expect(refusal(res)).toEqual({ http: 422, code: 'COORDINATES_CITY_MISMATCH', message: OUTSIDE_CITY });
  });

  it('партнёр переносит точку в город — сохраняется', async () => {
    const id = await card(partner, OUTSIDE_MINSK);
    const est = await loaded(id);

    const res = await as(partner).update(id, appEditBody(est, { latitude: 53.9, longitude: 27.56 }));
    expect(res.status).toBe(200);
    expect(await stored(id)).toMatchObject({ latitude: 53.9, longitude: 27.56 });
  });
});
