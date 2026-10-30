/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: остатки находок сессий А и Б нитки «Остатки „500 вместо
 * отказа“» на сервере (сессия Г, 20.10.2026).
 *
 * 1. Н9 — медиа карточки (/partner/establishments/:id/media): только id
 *    карточки так, как его пишет база. До правки id прописными проходил
 *    (isUUID), файл ложился в папку облака с прописными, и правило владения
 *    её не признавало — откат и удаление файл оставляли; не-UUID получал
 *    английский 422. Теперь — отказ «чужой или удалённой карточки» до приёма
 *    файла: 404 ESTABLISHMENT_NOT_FOUND.
 * 2. Н13 — медиа карточки: отказы полей, правки, удаления и списка по-русски;
 *    коды и статусы прежние. Сводка ответа валидатора — первый русский текст
 *    поля; у других маршрутов сводка прежняя («Validation failed»).
 * 3. Н10 — аватар: размер, формат, без файла — по-русски, статусы и коды
 *    прежние (текст размера утверждён Координатором 20.10.2026).
 * 4. Н14 — акции: список и удаление — только канонический id; отказ —
 *    существующими текстами: список, как создание, — 400 «Не выбрано
 *    заведение.», удаление, как правка, — 404 «Акция не найдена…».
 *
 * Ожидания — литералы формулировок, не ссылки на модуль текстов. Облако —
 * настоящий config/cloudinary.js, подменены только вызовы SDK.
 */

import fs from 'fs';
import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import * as MediaService from '../../services/mediaService.js';
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';
import { clearAllData, query } from '../utils/database.js';
import { createStandardTestUsers, createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const MB = 1024 * 1024;
const JPEG = { filename: 'photo.jpg', contentType: 'image/jpeg' };
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const TEXT = {
  // Утверждены Координатором 15.10.2026 (тексты карточки).
  notOwner: 'Нет доступа к этому заведению — возможно, оно удалено или принадлежит другой учётной записи. Обновите список заведений.',
  // Медиа карточки, 20.10.2026 — по образцу утверждённых.
  mediaNotFound: 'Файл не найден — возможно, его уже удалили. Обновите страницу.',
  uploadFormInvalid: 'Не удалось загрузить файл. Обновите страницу и попробуйте ещё раз.',
  changeInvalid: 'Не удалось сохранить изменения. Обновите страницу и попробуйте ещё раз.',
  listFilterInvalid: 'Не удалось показать файлы. Обновите страницу и попробуйте ещё раз.',
  captionTooLong: 'Подпись к фото — не длиннее 255 знаков',
  // Аватар: размер — слово Координатора 20.10.2026, формат и пустой запрос —
  // директива сессии того же дня.
  avatarTooLarge: 'Фото больше 5 МБ. Выберите фото поменьше.',
  avatarType: 'Такой формат фото не подходит. Нужны JPEG, PNG или WebP.',
  avatarRequired: 'Выберите фото.',
  // Акции — утверждены 13.10.2026.
  establishmentRequired: 'Не выбрано заведение.',
  promotionNotFound: 'Акция не найдена — возможно, её уже удалили. Обновите список акций.',
};

let users;
let card;
let strangerCard;
let strangerMediaId;
let mediaId;
let promotionId;
let cloudUpload;
let cloudDestroy;

const bearer = (who) => `Bearer ${users[who].accessToken}`;
const refusal = (res) => ({ status: res.status, code: res.body.error?.code, message: res.body.message });

const uploadTo = (cardId, { type = 'interior', fields = {}, token = bearer('partner') } = {}) => {
  const req = request(app)
    .post(`/api/v1/partner/establishments/${cardId}/media`)
    .set('Authorization', token);
  if (type !== null) req.field('type', type); // null — поле не послано
  for (const [name, value] of Object.entries(fields)) req.field(name, value);
  return req.attach('file', Buffer.from('fake-jpeg'), JPEG);
};

const tempFiles = () => fs.readdirSync(TEMP_UPLOAD_DIR);

beforeAll(async () => {
  await clearAllData();
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  users = await createStandardTestUsers();
  card = await createTestEstablishment(users.partner.user.id);

  const stranger = await createUserAndGetTokens({
    email: `g-stranger-${Date.now()}@test.com`,
    password: 'Partner123!@#',
    name: 'Чужой партнёр',
    role: 'partner',
  });
  users.stranger = stranger;
  strangerCard = await createTestEstablishment(stranger.user.id);
});

afterAll(async () => {
  await clearAllData();
});

beforeEach(async () => {
  let n = 0;
  cloudUpload = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => {
    n += 1;
    return {
      public_id: `${options.folder}/g${String(n).padStart(4, '0')}`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/g${n}.jpg`,
      width: 800,
      height: 600,
      format: 'jpg',
      bytes: 2048,
      pages: 1,
    };
  });
  cloudDestroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Н9 — медиа карточки: только id карточки так, как его пишет база', () => {
  beforeAll(async () => {
    jest.spyOn(cloudinarySdk.uploader, 'upload').mockResolvedValue({
      public_id: `establishments/${card.id}/interior/seed`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1/establishments/${card.id}/interior/seed.jpg`,
      width: 800, height: 600, format: 'jpg', bytes: 2048, pages: 1,
    });
    const own = await uploadTo(card.id);
    expect(own.status).toBe(201);
    mediaId = own.body.data.id;
    jest.restoreAllMocks();
  });

  const NOT_OWNER = { status: 404, code: 'ESTABLISHMENT_NOT_FOUND', message: TEXT.notOwner };

  test('загрузка с id прописными — отказ до приёма файла: облако и диск не тронуты', async () => {
    const before = tempFiles();

    const res = await uploadTo(card.id.toUpperCase());

    expect(refusal(res)).toEqual(NOT_OWNER);
    expect(cloudUpload).not.toHaveBeenCalled();
    expect(tempFiles()).toEqual(before);
    const { rows } = await query('SELECT count(*)::int AS n FROM establishment_media WHERE establishment_id = $1', [card.id]);
    expect(rows[0].n).toBe(1);
  });

  test.each([
    ['не UUID', 'not-a-card'],
    ['UUID в фигурных скобках (база прочла бы его как ту же карточку)', null],
  ])('загрузка: %s — тот же отказ', async (_label, id) => {
    const res = await uploadTo(id ?? `{${card.id}}`);

    expect(refusal(res)).toEqual(NOT_OWNER);
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('список, правка и удаление с id прописными — тот же отказ, файл и строка целы', async () => {
    const upper = card.id.toUpperCase();
    const list = await request(app)
      .get(`/api/v1/partner/establishments/${upper}/media`)
      .set('Authorization', bearer('partner'));
    const update = await request(app)
      .put(`/api/v1/partner/establishments/${upper}/media/${mediaId}`)
      .set('Authorization', bearer('partner'))
      .send({ caption: 'Новая подпись' });
    const remove = await request(app)
      .delete(`/api/v1/partner/establishments/${upper}/media/${mediaId}`)
      .set('Authorization', bearer('partner'));

    expect([refusal(list), refusal(update), refusal(remove)]).toEqual([NOT_OWNER, NOT_OWNER, NOT_OWNER]);
    expect(cloudDestroy).not.toHaveBeenCalled();
    const { rows } = await query('SELECT caption FROM establishment_media WHERE id = $1', [mediaId]);
    expect(rows).toEqual([{ caption: null }]);
  });

  test('без входа — 401, не партнёр — 403, как прежде: проверка id стоит после них', async () => {
    const url = `/api/v1/partner/establishments/${card.id.toUpperCase()}/media`;
    const anonymous = await request(app).get(url);
    const guest = await request(app).get(url).set('Authorization', bearer('regular'));

    expect([anonymous.status, guest.status]).toEqual([401, 403]);
  });

  test('id в нижнем регистре — как прежде: список отдаётся', async () => {
    const res = await request(app)
      .get(`/api/v1/partner/establishments/${card.id}/media`)
      .set('Authorization', bearer('partner'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.id)).toEqual([mediaId]);
  });
});

describe('Н13 — медиа карточки: отказы по-русски, коды и статусы прежние', () => {
  beforeAll(async () => {
    jest.spyOn(cloudinarySdk.uploader, 'upload').mockResolvedValue({
      public_id: `establishments/${strangerCard.id}/interior/seed`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1/establishments/${strangerCard.id}/interior/seed.jpg`,
      width: 800, height: 600, format: 'jpg', bytes: 2048, pages: 1,
    });
    const theirs = await uploadTo(strangerCard.id, { token: bearer('stranger') });
    expect(theirs.status).toBe(201);
    strangerMediaId = theirs.body.data.id;
    jest.restoreAllMocks();
  });

  /** 422 VALIDATION_ERROR: сводка — текст поля, он же в details. */
  const fieldRefusal = (res, field, text) => {
    expect(refusal(res)).toEqual({ status: 422, code: 'VALIDATION_ERROR', message: text });
    expect(res.body.error.details.map((d) => [d.field, d.message])).toContainEqual([field, text]);
    expect(res.body.error.details.filter((d) => !/[А-Яа-яЁё]/.test(d.message))).toEqual([]);
  };

  test.each([
    ['без раздела', null, {}, 'type'],
    ['неизвестный раздел', 'kitchen', {}, 'type'],
    ['is_primary — не флаг', 'interior', { is_primary: 'maybe' }, 'is_primary'],
  ])('загрузка: %s — «обновите страницу», в облако ничего', async (_label, type, fields, field) => {
    const res = await uploadTo(card.id, { type, fields });

    fieldRefusal(res, field, TEXT.uploadFormInvalid);
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('загрузка: подпись длиннее 255 знаков — текст подписи', async () => {
    const res = await uploadTo(card.id, { fields: { caption: 'а'.repeat(256) } });

    fieldRefusal(res, 'caption', TEXT.captionTooLong);
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('список: неизвестный раздел в фильтре', async () => {
    const res = await request(app)
      .get(`/api/v1/partner/establishments/${card.id}/media?type=kitchen`)
      .set('Authorization', bearer('partner'));

    fieldRefusal(res, 'type', TEXT.listFilterInvalid);
  });

  test.each([
    ['позиция отрицательная', { position: -1 }, 'position', TEXT.changeInvalid],
    ['is_primary — не флаг', { is_primary: 'maybe' }, 'is_primary', TEXT.changeInvalid],
    ['подпись длиннее 255 знаков', { caption: 'б'.repeat(256) }, 'caption', TEXT.captionTooLong],
  ])('правка: %s', async (_label, body, field, text) => {
    const res = await request(app)
      .put(`/api/v1/partner/establishments/${card.id}/media/${mediaId}`)
      .set('Authorization', bearer('partner'))
      .send(body);

    fieldRefusal(res, field, text);
  });

  // Два прямых запроса, которые до ревью 20.10.2026 давали 500: позиция за
  // пределом integer (22003) и правка без единого поля («No fields to update»).
  test.each([
    ['позиция больше 2147483647', { position: 3000000000 }],
    ['ни одного поля', {}],
  ])('правка: %s — «обновите страницу», не 500', async (_label, body) => {
    const res = await request(app)
      .put(`/api/v1/partner/establishments/${card.id}/media/${mediaId}`)
      .set('Authorization', bearer('partner'))
      .send(body);

    expect(refusal(res)).toEqual({ status: 422, code: 'VALIDATION_ERROR', message: TEXT.changeInvalid });
  });

  test('правка: позиция ровно 2147483647 — сохранена', async () => {
    const res = await request(app)
      .put(`/api/v1/partner/establishments/${card.id}/media/${mediaId}`)
      .set('Authorization', bearer('partner'))
      .send({ position: 2147483647 });

    expect(res.status).toBe(200);
    expect(res.body.data.position).toBe(2147483647);
  });

  test.each(['put', 'delete'])('%s: id файла — не UUID — «файл не найден», 422 как прежде', async (method) => {
    const res = await request(app)[method](`/api/v1/partner/establishments/${card.id}/media/not-a-file`)
      .set('Authorization', bearer('partner'))
      .send({ caption: 'x' });

    fieldRefusal(res, 'mediaId', TEXT.mediaNotFound);
  });

  test.each([
    ['нет такого файла', () => '00000000-0000-4000-8000-000000000000'],
    ['файл чужой карточки', () => strangerMediaId],
  ])('правка и удаление: %s — 404 MEDIA_NOT_FOUND, файл цел', async (_label, id) => {
    const update = await request(app)
      .put(`/api/v1/partner/establishments/${card.id}/media/${id()}`)
      .set('Authorization', bearer('partner'))
      .send({ caption: 'x' });
    const remove = await request(app)
      .delete(`/api/v1/partner/establishments/${card.id}/media/${id()}`)
      .set('Authorization', bearer('partner'));

    const NOT_FOUND = { status: 404, code: 'MEDIA_NOT_FOUND', message: TEXT.mediaNotFound };
    expect([refusal(update), refusal(remove)]).toEqual([NOT_FOUND, NOT_FOUND]);
    expect(cloudDestroy).not.toHaveBeenCalled();
    const { rows } = await query('SELECT count(*)::int AS n FROM establishment_media WHERE id = $1', [strangerMediaId]);
    expect(rows[0].n).toBe(1);
  });

  test('чужая карточка: список, правка и удаление — текст карточки, 404 ESTABLISHMENT_NOT_FOUND', async () => {
    const base = `/api/v1/partner/establishments/${strangerCard.id}/media`;
    const list = await request(app).get(base).set('Authorization', bearer('partner'));
    const update = await request(app).put(`${base}/${strangerMediaId}`).set('Authorization', bearer('partner')).send({ caption: 'x' });
    const remove = await request(app).delete(`${base}/${strangerMediaId}`).set('Authorization', bearer('partner'));

    const NOT_OWNER = { status: 404, code: 'ESTABLISHMENT_NOT_FOUND', message: TEXT.notOwner };
    expect([refusal(list), refusal(update), refusal(remove)]).toEqual([NOT_OWNER, NOT_OWNER, NOT_OWNER]);
    expect(cloudDestroy).not.toHaveBeenCalled();
  });

  test('проверка раздела в сервисе (маршрут отказывает раньше) — тот же текст, код INVALID_MEDIA_TYPE', async () => {
    await expect(MediaService.uploadMedia(users.partner.user.id, card.id, { size: 10, mimetype: 'image/jpeg' }, { type: 'kitchen' }))
      .rejects.toMatchObject({ statusCode: 422, code: 'INVALID_MEDIA_TYPE', message: TEXT.uploadFormInvalid });
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('другие маршруты: сводка прежняя — «Validation failed», хотя текст поля русский', async () => {
    const res = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', bearer('partner'))
      .send({ name: 'Карточка', city: 'Атлантида' });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.error.details.map((d) => d.message)).toContain('Выберите город из списка.');
  });
});

describe('Н10 — аватар: отказы по-русски, статусы и коды прежние', () => {
  const avatar = () => request(app).post('/api/v1/auth/avatar').set('Authorization', bearer('regular'));
  const avatarRefusal = (res) => ({ status: res.status, code: res.body.error?.code, message: res.body.error?.message });

  test('без файла — «Выберите фото.», 400 NO_FILE', async () => {
    const res = await avatar();

    expect(avatarRefusal(res)).toEqual({ status: 400, code: 'NO_FILE', message: TEXT.avatarRequired });
  });

  test('не тот формат — 400 INVALID_FILE_TYPE', async () => {
    const res = await avatar().attach('avatar', Buffer.from('GIF89a'), { filename: 'a.gif', contentType: 'image/gif' });

    expect(avatarRefusal(res)).toEqual({ status: 400, code: 'INVALID_FILE_TYPE', message: TEXT.avatarType });
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('больше 5 МБ — утверждённый текст, 400 FILE_TOO_LARGE; ровно 5 МБ — принято', async () => {
    const over = await avatar().attach('avatar', Buffer.alloc(5 * MB + 1), { filename: 'a.png', contentType: 'image/png' });
    expect(avatarRefusal(over)).toEqual({ status: 400, code: 'FILE_TOO_LARGE', message: TEXT.avatarTooLarge });
    expect(cloudUpload).not.toHaveBeenCalled();

    const exact = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * MB - PNG_BYTES.length)]);
    const fits = await avatar().attach('avatar', exact, { filename: 'a.png', contentType: 'image/png' });
    expect(fits.status).toBe(200);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });
});

describe('Н14 — акции: список и удаление — только канонический id', () => {
  beforeAll(async () => {
    const created = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', bearer('partner'))
      .field('establishment_id', card.id)
      .field('title', 'Акция Г');
    expect(created.status).toBe(201);
    promotionId = created.body.data.id;
  });

  const list = (id) => request(app)
    .get(`/api/v1/partner/promotions/establishment/${id}`)
    .set('Authorization', bearer('partner'));
  const remove = (id) => request(app)
    .delete(`/api/v1/partner/promotions/${id}`)
    .set('Authorization', bearer('partner'));

  const NOT_CHOSEN = { status: 400, code: 'VALIDATION_ERROR', message: TEXT.establishmentRequired };
  const NOT_FOUND = { status: 404, code: 'PROMOTION_NOT_FOUND', message: TEXT.promotionNotFound };

  test.each([
    ['не UUID', () => 'not-a-card'],
    ['id прописными', () => card.id.toUpperCase()],
  ])('список: %s — «Не выбрано заведение.», как на создании', async (_label, id) => {
    expect(refusal(await list(id()))).toEqual(NOT_CHOSEN);
  });

  test('список: id в нижнем регистре — как прежде', async () => {
    const res = await list(card.id);

    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id)).toContain(promotionId);
  });

  test.each([
    ['не UUID', () => 'not-a-promotion'],
    ['id прописными', () => promotionId.toUpperCase()],
  ])('удаление: %s — «Акция не найдена…», как на правке; акция цела', async (_label, id) => {
    expect(refusal(await remove(id()))).toEqual(NOT_FOUND);

    const { rows } = await query('SELECT status FROM promotions WHERE id = $1', [promotionId]);
    expect(rows).toEqual([{ status: 'active' }]);
  });

  test('удаление: id в нижнем регистре — как прежде', async () => {
    const res = await remove(promotionId);

    expect(res.status).toBe(200);
    const { rows } = await query('SELECT status FROM promotions WHERE id = $1', [promotionId]);
    expect(rows).toEqual([{ status: 'expired' }]);
  });
});
