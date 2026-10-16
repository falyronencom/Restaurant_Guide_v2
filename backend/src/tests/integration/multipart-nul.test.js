/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration: NUL (U+0000) в форме с файлом — отказ 400 на каждом загрузчике.
 *
 * Фильтр на входе (middleware/requestGuard.js) видит тело JSON и формы
 * urlencoded, а multipart разбирает multer уже внутри маршрута. До правки
 * (проба стенда 16.10.2026 на прежнем коде):
 * - NUL в текстовом поле доходил до базы — акция: 500 и код базы 22021
 *   наружу, подпись фото карточки: 500;
 * - NUL в имени файла (параметр `filename*` по RFC 5987, `%00`) попадал в
 *   путь временного файла, и запрос заканчивался сбоем записи.
 * После правки — тот же отказ, что у NUL в JSON-теле: 400 INVALID_FORMAT,
 * временный файл убран, до облака и базы запрос не доходит, в журнале —
 * «Client error occurred», не «Server error occurred».
 *
 * Загрузчики — все четыре (как в multipart-limits.test.js): аватар, временные
 * загрузки мастера и кабинета, медиа карточки, акции (создание и правка).
 * Сырой NUL в заголовке части формы busboy отвергает сам («Malformed part
 * header») — это отказ формы, которую busboy не прочёл (400 с другим текстом,
 * unit/uploadNulGuard.test.js), здесь не проверяется.
 */

import fs from 'fs';
import request from 'supertest';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';
import { clearAllData } from '../utils/database.js';
import { createStandardTestUsers, createTestEstablishment } from '../utils/auth.js';

const NUL = String.fromCharCode(0);
const BODY_NUL = 'В тексте есть невидимый символ, который нельзя отправить. Наберите текст заново и попробуйте ещё раз.';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PNG = { filename: 'photo.png', contentType: 'image/png' };

let users;
let establishment;
let promotionId;
let cloudUpload;
let errorSpy;
let warnSpy;

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
  cloudUpload = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => ({
    public_id: `${options.folder}/nul0001`,
    secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/nul0001.png`,
    width: 800,
    height: 600,
    format: 'png',
    bytes: 2048,
  }));
  errorSpy = jest.spyOn(logger, 'error');
  warnSpy = jest.spyOn(logger, 'warn');
});

afterEach(() => {
  jest.restoreAllMocks();
});

const bearer = (who) => `Bearer ${users[who].accessToken}`;

/** Загрузчики: адрес, кто шлёт, поле файла и поля, без которых маршрут не примет форму. */
const UPLOADERS = [
  { label: 'аватар', method: 'post', path: () => '/api/v1/auth/avatar', who: 'regular', fileField: 'avatar', fields: () => ({}) },
  { label: 'временная загрузка (мастер, кабинет)', method: 'post', path: () => '/api/v1/partner/media/upload', who: 'partner', fileField: 'file', fields: () => ({ type: 'interior' }) },
  { label: 'медиа карточки', method: 'post', path: () => `/api/v1/partner/establishments/${establishment.id}/media`, who: 'partner', fileField: 'file', fields: () => ({ type: 'interior' }) },
  { label: 'акция: создание', method: 'post', path: () => '/api/v1/partner/promotions', who: 'partner', fileField: 'image', fields: () => ({ establishment_id: establishment.id, title: 'Акция' }) },
  { label: 'акция: правка', method: 'patch', path: () => `/api/v1/partner/promotions/${promotionId}`, who: 'partner', fileField: 'image', fields: () => ({ title: 'Акция' }) },
];

const tempEntries = () => new Set(fs.readdirSync(TEMP_UPLOAD_DIR));
const newEntriesSince = (before) => fs.readdirSync(TEMP_UPLOAD_DIR).filter((name) => !before.has(name));
// Маршрут временной загрузки удаляет свой файл, не дожидаясь, — ответ может
// прийти раньше (как в multipart-limits.test.js).
const waitUntil = async (predicate, timeoutMs = 2000, stepMs = 20) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
};

/**
 * Форма вручную: superagent не умеет параметр `filename*` (RFC 5987), а
 * busboy его раскрывает, `%00` — в U+0000. Имени поля так NUL не передать:
 * `name*` busboy не читает (multer отвечает MISSING_FIELD_NAME), сырой NUL в
 * заголовке — «Malformed part header».
 */
const BOUNDARY = 'nulFormBoundary4f6c2a';
function rawForm(parts) {
  const chunks = [];
  for (const { disposition, contentType, content } of parts) {
    let head = `--${BOUNDARY}\r\nContent-Disposition: form-data; ${disposition}\r\n`;
    if (contentType) head += `Content-Type: ${contentType}\r\n`;
    chunks.push(Buffer.from(`${head}\r\n`, 'latin1'), Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

const textParts = (fields) => Object.entries(fields).map(([name, value]) => ({ disposition: `name="${name}"`, content: value }));

function sendRaw(uploader, parts) {
  return request(app)[uploader.method](uploader.path())
    .set('Authorization', bearer(uploader.who))
    .set('Content-Type', `multipart/form-data; boundary=${BOUNDARY}`)
    .send(rawForm(parts));
}

function sendForm(uploader, fields, { withFile = true } = {}) {
  let req = request(app)[uploader.method](uploader.path()).set('Authorization', bearer(uploader.who));
  for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
  if (withFile) req = req.attach(uploader.fileField, PNG_BYTES, PNG);
  return req;
}

/** Отказ: тот же, что у NUL в JSON-теле; ни облака, ни ошибки сервера, ни файла на диске. */
function expectNulRefused(res, before) {
  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.error.code).toBe('INVALID_FORMAT');
  expect(res.body.message).toBe(BODY_NUL);
  expect(cloudUpload).not.toHaveBeenCalled();
  expect(errorSpy.mock.calls.filter(([message]) => message === 'Server error occurred')).toEqual([]);
  expect(warnSpy).toHaveBeenCalledWith(
    'Client error occurred',
    expect.objectContaining({ statusCode: 400, errorCode: 'INVALID_FORMAT' }),
  );
  expect(newEntriesSince(before)).toEqual([]);
}

describe('NUL в значении текстового поля → 400, файл убран', () => {
  test.each(UPLOADERS.map((u) => [u.label, u]))('%s', async (_label, uploader) => {
    const before = tempEntries();
    const res = await sendForm(uploader, { ...uploader.fields(), note: `x${NUL}y` });
    expectNulRefused(res, before);
  });

  test('акция: название (до правки 500, наружу код базы 22021)', async () => {
    const before = tempEntries();
    const res = await sendForm(UPLOADERS[3], { establishment_id: establishment.id, title: `Скидка${NUL}` }, { withFile: false });
    expectNulRefused(res, before);
  });

  test('акция: правка названия (до правки 500)', async () => {
    const before = tempEntries();
    const res = await sendForm(UPLOADERS[4], { title: `Скидка${NUL}` }, { withFile: false });
    expectNulRefused(res, before);
  });

  test('медиа карточки: подпись к фото (до правки 500)', async () => {
    const before = tempEntries();
    const res = await sendForm(UPLOADERS[2], { type: 'interior', caption: `Зал${NUL}` });
    expectNulRefused(res, before);
  });
});

describe('NUL в имени файла (`filename*`) → 400, до записи на диск', () => {
  test.each(UPLOADERS.map((u) => [u.label, u]))('%s: в расширении', async (_label, uploader) => {
    const before = tempEntries();
    const res = await sendRaw(uploader, [
      ...textParts(uploader.fields()),
      { disposition: `name="${uploader.fileField}"; filename*=utf-8''photo.pn%00g`, contentType: 'image/png', content: PNG_BYTES },
    ]);
    expectNulRefused(res, before);
  });

  test('акция: в середине имени, до точки', async () => {
    const before = tempEntries();
    const res = await sendRaw(UPLOADERS[3], [
      ...textParts(UPLOADERS[3].fields()),
      { disposition: "name=\"image\"; filename*=utf-8''pho%00to.png", contentType: 'image/png', content: PNG_BYTES },
    ]);
    expectNulRefused(res, before);
  });
});

describe('форма без NUL проходит как прежде', () => {
  test('временная загрузка: 201, облако позвано, файл убран', async () => {
    const before = tempEntries();
    // U+0001 база принимает — правило берёт только NUL.
    const res = await sendForm(UPLOADERS[1], { type: 'interior', note: `x${String.fromCharCode(1)}y` });
    expect(res.status).toBe(201);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
    await waitUntil(() => newEntriesSince(before).length === 0);
    expect(newEntriesSince(before)).toEqual([]);
  });

  test('акция: имя файла в `filename*` без NUL — 201', async () => {
    // Своя карточка: у заведения не больше трёх активных акций, а на старом
    // коде формы выше их создавали.
    const own = await createTestEstablishment(users.partner.user.id);
    const res = await sendRaw(UPLOADERS[3], [
      ...textParts({ establishment_id: own.id, title: 'Акция с картинкой' }),
      { disposition: "name=\"image\"; filename*=utf-8''%D1%84%D0%BE%D1%82%D0%BE.png", contentType: 'image/png', content: PNG_BYTES },
    ]);
    expect(res.status).toBe(201);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });
});
