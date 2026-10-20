/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: модуль загрузки — имя временного файла, русские отказы медиа
 * карточки и акции, PDF больше предела облака (сессия Б нитки «Остатки „500
 * вместо отказа“», 19.10.2026).
 *
 * 1. Имя временного файла — uuid и расширение по типу файла, имя клиента на
 *    диск не попадает. До правки (проба PR #52, 16.10.2026) имя файла с очень
 *    длинным расширением давало 500 на любом загрузчике: запись временного
 *    файла падала, в журнал — «Server error occurred». Теперь расширение
 *    клиента судят прежние проверки формата (422 там, где они есть), а запись
 *    не падает.
 * 2. Картинка акции больше 10 МБ — утверждённый текст (Координатор, 13.10),
 *    статус 413 и код LIMIT_FILE_SIZE прежние; до правки — «File too large».
 * 3. Медиа карточки (POST /partner/establishments/:id/media) — отказы по типу
 *    и лимитам русским текстом из словарей отказов партнёра; коды и статусы
 *    прежние (сайт переводит по коду). До правки — английский.
 * 4. PDF больше предела облака (10 МБ на тарифе Free) — отказ до облака
 *    текстом Координатора (17.10.2026), на мастере и на медиа карточки, 422
 *    FILE_TOO_LARGE — как прочие отказы размера на этих путях. Граница: ровно
 *    10 МБ проходит.
 *
 * Ожидания — литералы утверждённых формулировок, не ссылки на модуль текстов:
 * тест должен краснеть, если текст в модуле поменяли без слова Координатора.
 * Облако — настоящий config/cloudinary.js, подменён только вызов SDK.
 */

import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import pool from '../../config/database.js';
import * as MediaModel from '../../models/mediaModel.js';
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';
import { clearAllData } from '../utils/database.js';
import { createStandardTestUsers, createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const LONG_EXTENSION = 'x'.repeat(300);
const MB = 1024 * 1024;

const TEXT = {
  invalidFileType: 'Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.',
  pdfOnlyInMenu: 'PDF можно добавить только в меню.',
  photoTooLarge: 'Фото больше 10 МБ. Выберите фото поменьше.',
  fileTooLarge: 'Файл больше 60 МБ. Выберите файл поменьше.',
  unexpectedField: 'Не удалось загрузить файл. Попробуйте ещё раз.',
  pdfOverCloudLimit: 'Файл PDF больше 10 МБ — уменьшите его или загрузите меню фотографиями',
  pdfLimit: 'Можно добавить не больше 2 файлов меню в формате PDF.',
  interiorLimit: 'Можно добавить не больше 30 фото интерьера.',
  dishesLimit: 'Можно добавить не больше 30 фото.',
  promotionImageTooLarge: 'Картинка больше 10 МБ. Выберите фото поменьше.',
};

/** Имя временного файла: uuid v4 и расширение по типу. */
const TEMP_NAME = (ext) => new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}${ext.replace('.', '\\.')}$`);

let users;
let establishment;
let promotionId;
let cloudUpload;
let errorSpy;

beforeAll(async () => {
  await clearAllData();
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  users = await createStandardTestUsers();
  establishment = await createTestEstablishment(users.partner.user.id);

  const created = await request(app)
    .post('/api/v1/partner/promotions')
    .set('Authorization', `Bearer ${users.partner.accessToken}`)
    .field('establishment_id', establishment.id)
    .field('title', 'Акция для правки');
  expect(created.status).toBe(201);
  promotionId = created.body.data.id;
});

afterAll(async () => {
  await clearAllData();
});

beforeEach(() => {
  let n = 0;
  cloudUpload = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => {
    n += 1;
    return {
      public_id: `${options.folder}/hard${String(n).padStart(4, '0')}`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/hard${n}.png`,
      width: 800,
      height: 600,
      format: 'png',
      bytes: 2048,
      pages: 1,
    };
  });
  errorSpy = jest.spyOn(logger, 'error');
});

afterEach(() => {
  jest.restoreAllMocks();
});

const bearer = (who) => `Bearer ${users[who].accessToken}`;
const cardMedia = () => request(app)
  .post(`/api/v1/partner/establishments/${establishment.id}/media`)
  .set('Authorization', bearer('partner'));
const tempUpload = () => request(app)
  .post('/api/v1/partner/media/upload')
  .set('Authorization', bearer('partner'));

const serverErrors = () => errorSpy.mock.calls.filter(([message]) => message === 'Server error occurred');

const refusal = (res) => ({ status: res.status, code: res.body.error?.code, message: res.body.message });

describe('имя временного файла — по типу файла, не по имени клиента', () => {
  const photoWithLongExtension = { filename: `photo.${LONG_EXTENSION}`, contentType: 'image/png' };

  test('аватар: длинное расширение — фото принято, временный файл назван uuid.png', async () => {
    const res = await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', bearer('regular'))
      .attach('avatar', PNG_BYTES, photoWithLongExtension);

    expect(res.status).toBe(200);
    expect(serverErrors()).toEqual([]);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
    expect(path.basename(cloudUpload.mock.calls[0][0])).toMatch(TEMP_NAME('.png'));
  });

  test('акция: длинное расширение — картинка принята, временный файл назван uuid.png', async () => {
    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${promotionId}`)
      .set('Authorization', bearer('partner'))
      .field('title', 'Акция для правки')
      .attach('image', PNG_BYTES, photoWithLongExtension);

    expect(res.status).toBe(200);
    expect(serverErrors()).toEqual([]);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
    expect(path.basename(cloudUpload.mock.calls[0][0])).toMatch(TEMP_NAME('.png'));
  });

  test('загрузка в мастере: длинное расширение — отказ формата 422, не 500', async () => {
    const res = await tempUpload().field('type', 'interior').attach('file', PNG_BYTES, photoWithLongExtension);

    expect(refusal(res)).toEqual({ status: 422, code: 'INVALID_FILE_TYPE', message: TEXT.invalidFileType });
    expect(serverErrors()).toEqual([]);
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('медиа карточки: длинное расширение — отказ формата 422, не 500', async () => {
    const res = await cardMedia().field('type', 'interior').attach('file', PNG_BYTES, photoWithLongExtension);

    expect(refusal(res)).toEqual({ status: 422, code: 'INVALID_FILE_TYPE', message: TEXT.invalidFileType });
    expect(serverErrors()).toEqual([]);
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('PDF в мастере: временный файл назван uuid.pdf, имя клиента — только в проверке формата', async () => {
    const res = await tempUpload()
      .field('type', 'menu')
      .attach('file', Buffer.from('%PDF-1.4\n%fake\n'), { filename: 'Меню ресторана.PDF', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(path.basename(cloudUpload.mock.calls[0][0])).toMatch(TEMP_NAME('.pdf'));
  });
});

describe('акция: картинка больше 10 МБ — утверждённый текст, 413 и код прежние', () => {
  test('создание', async () => {
    const res = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', bearer('partner'))
      .field('establishment_id', establishment.id)
      .field('title', 'Акция с большой картинкой')
      .attach('image', Buffer.alloc(10 * MB + 1, 0), { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect(refusal(res)).toEqual({ status: 413, code: 'LIMIT_FILE_SIZE', message: TEXT.promotionImageTooLarge });
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('правка', async () => {
    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${promotionId}`)
      .set('Authorization', bearer('partner'))
      .field('title', 'Акция для правки')
      .attach('image', Buffer.alloc(10 * MB + 1, 0), { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect(refusal(res)).toEqual({ status: 413, code: 'LIMIT_FILE_SIZE', message: TEXT.promotionImageTooLarge });
  });

  test('другие отказы multer на акции — как были (поле не то: 400, его код)', async () => {
    const res = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', bearer('partner'))
      .field('establishment_id', establishment.id)
      .field('title', 'Акция')
      .attach('photo', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LIMIT_UNEXPECTED_FILE');
  });
});

describe('медиа карточки: отказы по типу и лимитам — по-русски, коды прежние', () => {
  afterEach(async () => {
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
  });

  test('тип файла, который не пропускает фильтр загрузчика (GIF)', async () => {
    const res = await cardMedia().field('type', 'interior').attach('file', PNG_BYTES, { filename: 'a.gif', contentType: 'image/gif' });
    expect(refusal(res)).toEqual({ status: 422, code: 'INVALID_FILE_TYPE', message: TEXT.invalidFileType });
  });

  test('тип файла фото, расширение чужое', async () => {
    const res = await cardMedia().field('type', 'interior').attach('file', PNG_BYTES, { filename: 'a.gif', contentType: 'image/png' });
    expect(refusal(res)).toEqual({ status: 422, code: 'INVALID_FILE_TYPE', message: TEXT.invalidFileType });
  });

  test('тип файла PDF, расширение не .pdf', async () => {
    const res = await cardMedia().field('type', 'menu').attach('file', Buffer.from('%PDF-1.4'), { filename: 'menu.ai', contentType: 'application/pdf' });
    expect(refusal(res)).toEqual({ status: 422, code: 'INVALID_FILE_TYPE', message: TEXT.invalidFileType });
  });

  test('PDF не в разделе меню', async () => {
    const res = await cardMedia().field('type', 'interior').attach('file', Buffer.from('%PDF-1.4'), { filename: 'menu.pdf', contentType: 'application/pdf' });
    expect(refusal(res)).toEqual({ status: 422, code: 'PDF_TYPE_MISMATCH', message: TEXT.pdfOnlyInMenu });
  });

  test('фото больше 10 МБ', async () => {
    const res = await cardMedia().field('type', 'interior').attach('file', Buffer.alloc(10 * MB + 1, 0), { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(refusal(res)).toEqual({ status: 422, code: 'FILE_TOO_LARGE', message: TEXT.photoTooLarge });
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('файл больше 60 МБ — порог загрузчика', async () => {
    const res = await cardMedia().field('type', 'menu').attach('file', Buffer.alloc(60 * MB + 1, 0), { filename: 'menu.pdf', contentType: 'application/pdf' });
    expect(refusal(res)).toEqual({ status: 413, code: 'FILE_TOO_LARGE', message: TEXT.fileTooLarge });
  });

  test('файл в чужом поле формы', async () => {
    const res = await cardMedia().field('type', 'interior').attach('photo', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });
    expect(refusal(res)).toEqual({ status: 400, code: 'INVALID_UPLOAD_FIELD', message: TEXT.unexpectedField });
  });

  test('третий PDF меню', async () => {
    for (let i = 1; i <= 2; i += 1) {
      const ok = await cardMedia().field('type', 'menu').attach('file', Buffer.from(`%PDF-1.4 ${i}`), { filename: `m${i}.pdf`, contentType: 'application/pdf' });
      expect(ok.status).toBe(201);
    }
    const res = await cardMedia().field('type', 'menu').attach('file', Buffer.from('%PDF-1.4 3'), { filename: 'm3.pdf', contentType: 'application/pdf' });
    expect(refusal(res)).toEqual({ status: 403, code: 'PDF_LIMIT_EXCEEDED', message: TEXT.pdfLimit });
  });

  test.each([
    ['interior', TEXT.interiorLimit],
    ['dishes', TEXT.dishesLimit],
  ])('лимит фото (%s): 31-е — отказ', async (type, message) => {
    for (let position = 0; position < 30; position += 1) {
      await MediaModel.createMedia({
        establishment_id: establishment.id,
        type,
        file_type: 'image',
        url: `https://res.cloudinary.com/test/image/upload/establishments/${establishment.id}/${type}${position}`,
        thumbnail_url: null,
        preview_url: null,
        caption: null,
        position,
        is_primary: false,
      });
    }
    const res = await cardMedia().field('type', type).attach('file', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });
    expect(refusal(res)).toEqual({ status: 403, code: 'MEDIA_LIMIT_EXCEEDED', message });
    expect(cloudUpload).not.toHaveBeenCalled();
  });
});

describe('PDF больше предела облака (10 МБ) — отказ до облака текстом Координатора', () => {
  const pdf = (bytes) => {
    const buffer = Buffer.alloc(bytes, 0x20);
    buffer.write('%PDF-1.4\n', 0, 'latin1');
    return buffer;
  };

  afterEach(async () => {
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
  });

  test.each([
    ['загрузка в мастере', tempUpload],
    ['медиа карточки', cardMedia],
  ])('%s: 10 МБ + 1 байт — 422 FILE_TOO_LARGE, облако не звали', async (_label, send) => {
    const res = await send().field('type', 'menu').attach('file', pdf(10 * MB + 1), { filename: 'menu.pdf', contentType: 'application/pdf' });

    expect(refusal(res)).toEqual({ status: 422, code: 'FILE_TOO_LARGE', message: TEXT.pdfOverCloudLimit });
    expect(cloudUpload).not.toHaveBeenCalled();
    expect(serverErrors()).toEqual([]);
  });

  test.each([
    ['загрузка в мастере', tempUpload],
    ['медиа карточки', cardMedia],
  ])('%s: ровно 10 МБ — уходит в облако', async (_label, send) => {
    const res = await send().field('type', 'menu').attach('file', pdf(10 * MB), { filename: 'menu.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });
});

const tempEntries = () => new Set(fs.readdirSync(TEMP_UPLOAD_DIR));
const newEntriesSince = (before) => fs.readdirSync(TEMP_UPLOAD_DIR).filter((name) => !before.has(name));
// Мастер убирает отказанный файл, не дожидаясь, — ответ может прийти раньше.
const waitUntil = async (predicate, timeoutMs = 2000, stepMs = 20) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
};

describe('ревью Phase 3.5: уборка, порядок отказов, остатки английского в медиа карточки', () => {
  const pdf = (bytes) => {
    const buffer = Buffer.alloc(bytes, 0x20);
    buffer.write('%PDF-1.4\n', 0, 'latin1');
    return buffer;
  };

  afterEach(async () => {
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
  });

  test('мастер: PDF больше предела облака — временный файл убран', async () => {
    const before = tempEntries();
    const res = await tempUpload().field('type', 'menu').attach('file', pdf(10 * MB + 1), { filename: 'menu.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    await waitUntil(() => newEntriesSince(before).length === 0);
    expect(newEntriesSince(before)).toEqual([]);
  });

  test('карточка с двумя PDF: большой PDF — отказ лимита PDF, а не предела облака', async () => {
    for (let i = 1; i <= 2; i += 1) {
      const ok = await cardMedia().field('type', 'menu').attach('file', Buffer.from(`%PDF-1.4 ${i}`), { filename: `m${i}.pdf`, contentType: 'application/pdf' });
      expect(ok.status).toBe(201);
    }
    const res = await cardMedia().field('type', 'menu').attach('file', pdf(10 * MB + 1), { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(refusal(res)).toEqual({ status: 403, code: 'PDF_LIMIT_EXCEEDED', message: TEXT.pdfLimit });
  });

  test('медиа карточки без файла — «Файл не выбран.», код прежний', async () => {
    const res = await cardMedia().field('type', 'interior');
    expect(refusal(res)).toEqual({ status: 400, code: 'FILE_REQUIRED', message: 'Файл не выбран.' });
  });

  test('медиа чужой карточки — текст отказа владения, код и статус прежние', async () => {
    const stranger = await createUserAndGetTokens({
      email: `stranger-${Date.now()}@test.com`,
      password: 'Partner123!@#',
      name: 'Чужой партнёр',
      role: 'partner',
    });
    const res = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .field('type', 'interior')
      .attach('file', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(refusal(res)).toEqual({
      status: 404,
      code: 'ESTABLISHMENT_NOT_FOUND',
      message: 'Нет доступа к этому заведению — возможно, оно удалено или принадлежит другому аккаунту. Обновите список заведений.',
    });
    expect(cloudUpload).not.toHaveBeenCalled();
  });
});

// Н4 (ревью PR #86, находка 2): подпись считалась не как в базе — isLength не
// считает знаки вариации, varchar(255) их считает. 255 × «❤️» — 510 знаков:
// до правки проверка их пропускала, база отказывала (22001) → 500.
describe('подпись медиа карточки — длина как в базе', () => {
  const HEARTS = '❤️'.repeat(255);

  afterEach(async () => {
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
  });

  test('загрузка: 255 × «❤️» — отказ проверки 422, не 500, облако не звали', async () => {
    const res = await cardMedia()
      .field('type', 'interior')
      .field('caption', HEARTS)
      .attach('file', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(cloudUpload).not.toHaveBeenCalled();
    expect(serverErrors()).toEqual([]);
  });

  test('загрузка: ровно 255 знаков (эмодзи вне BMP — по одному) — принята', async () => {
    const res = await cardMedia()
      .field('type', 'interior')
      .field('caption', '🍕'.repeat(255))
      .attach('file', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
  });

  test('загрузка: подпись дважды в форме, одна длиннее 255 — отказ, как и прежде', async () => {
    const res = await cardMedia()
      .field('type', 'interior')
      .field('caption', 'коротко')
      .field('caption', 'x'.repeat(256))
      .attach('file', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(res.status).toBe(422);
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  // Поле дважды — массив: pg писал его литералом {"a","b"} (ревью, круг 2).
  test('загрузка: подпись дважды в форме, обе короткие — отказ, мусор в подпись не пишется', async () => {
    const res = await cardMedia()
      .field('type', 'interior')
      .field('caption', 'один')
      .field('caption', 'два')
      .attach('file', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('правка: 255 × «❤️» — отказ проверки 422, не 500', async () => {
    const created = await cardMedia().field('type', 'interior').attach('file', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });
    expect(created.status).toBe(201);

    const res = await request(app)
      .put(`/api/v1/partner/establishments/${establishment.id}/media/${created.body.data.id}`)
      .set('Authorization', bearer('partner'))
      .send({ caption: HEARTS });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(serverErrors()).toEqual([]);
  });
});

// Н6 (ревью PR #86, находка 4): id в акциях — только как его пишет база.
// Прописные клали картинку в папку, которую правило владения не признаёт;
// не-UUID доходил до базы — английский 400 (22P02).
describe('акции: id — только канонический UUID, отказ существующими текстами', () => {
  const NOT_FOUND = 'Акция не найдена — возможно, её уже удалили. Обновите список акций.';

  test.each([
    ['прописными', () => establishment.id.toUpperCase()],
    ['не UUID', () => 'not-a-uuid'],
    ['в фигурных скобках', () => `{${establishment.id}}`],
  ])('создание: id карточки %s — «Не выбрано заведение.», облако не звали, файл убран', async (_label, cardId) => {
    const before = tempEntries();
    const res = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', bearer('partner'))
      .field('establishment_id', cardId())
      .field('title', 'Акция')
      .attach('image', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(refusal(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR', message: 'Не выбрано заведение.' });
    expect(cloudUpload).not.toHaveBeenCalled();
    expect(serverErrors()).toEqual([]);
    expect(newEntriesSince(before)).toEqual([]);
  });

  test.each([
    ['прописными', () => promotionId.toUpperCase()],
    ['не UUID', () => 'not-a-uuid'],
  ])('правка: id акции %s — «Акция не найдена…» 404, облако не звали, файл убран', async (_label, id) => {
    const before = tempEntries();
    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${id()}`)
      .set('Authorization', bearer('partner'))
      .field('title', 'Акция')
      .attach('image', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });

    expect(refusal(res)).toEqual({ status: 404, code: 'PROMOTION_NOT_FOUND', message: NOT_FOUND });
    expect(cloudUpload).not.toHaveBeenCalled();
    expect(newEntriesSince(before)).toEqual([]);
  });

  test('канонический id — как прежде (правка проходит)', async () => {
    const res = await request(app)
      .patch(`/api/v1/partner/promotions/${promotionId}`)
      .set('Authorization', bearer('partner'))
      .field('title', 'Акция для правки');
    expect(res.status).toBe(200);
  });
});
