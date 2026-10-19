/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: middleware/upload.js — укрепление приёма файлов (сессия Б нитки
 * «Остатки „500 вместо отказа“», 19.10.2026; п. 7 брифа — линза PR #52).
 *
 * 1. Имя временного файла — uuid и расширение по типу файла (tempUploadName,
 *    tempUploadStorage); имя клиента на диск не попадает, тип вроде
 *    `constructor` не берёт унаследованный член словаря.
 * 2. Второй колбэк multer: после отказа конструктора busboy (Content-Type без
 *    границы) multer отвечает сразу, а его слушатели на запросе остаются —
 *    закрытие соединения до конца тела зовёт колбэк ещё раз. Цепочка маршрута
 *    должна пройти один раз.
 * 3. Что multer не смог убрать после отказа (err.storageErrors), — в журнал;
 *    уже исчезнувший файл (ENOENT) — нет.
 *
 * 4. Предел облака из настройки CLOUDINARY_MAX_FILE_MB (config/cloudinary.js).
 *
 * Настоящий multer и busboy на маленьком приложении, без базы.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import logger from '../../utils/logger.js';
import {
  TEMP_FILE_EXTENSIONS, TEMP_UPLOAD_DIR, createUpload, tempUploadName, tempUploadStorage,
} from '../../middleware/upload.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { CLOUD_MAX_FILE_MB, fitsCloudFileLimit, parseCloudMaxFileMb } from '../../config/cloudinary.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

beforeEach(() => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('имя временного файла — по типу файла', () => {
  test.each([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/heic', '.heic'],
    ['application/pdf', '.pdf'],
  ])('%s → uuid%s', (mimetype, ext) => {
    expect(tempUploadName(mimetype)).toMatch(new RegExp(`^${UUID}\\${ext}$`));
  });

  test.each(['image/gif', 'text/plain', '', undefined, 'constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'тип %p вне списка — без расширения',
    (mimetype) => {
      expect(tempUploadName(mimetype)).toMatch(new RegExp(`^${UUID}$`));
    },
  );

  test('список — ровно типы, которые пропускают фильтры загрузчиков', () => {
    expect(Object.keys(TEMP_FILE_EXTENSIONS).sort()).toEqual(
      ['application/pdf', 'image/heic', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    );
  });

  test('файл с расширением в 300 знаков пишется на диск под именем uuid.png', async () => {
    const app = express();
    app.post('/upload', createUpload({ storage: tempUploadStorage }).single('file'), (req, res) => {
      res.json({ name: path.basename(req.file.path), dir: path.dirname(req.file.path), original: req.file.originalname });
    });
    app.use(errorHandler);

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('png'), { filename: `photo.${'x'.repeat(300)}`, contentType: 'image/png' });

    try {
      expect(res.status).toBe(200);
      expect(res.body.name).toMatch(new RegExp(`^${UUID}\\.png$`));
      expect(path.resolve(res.body.dir)).toBe(path.resolve(TEMP_UPLOAD_DIR));
      // Имя клиента остаётся у файла — его судят проверки формата маршрута.
      expect(res.body.original).toBe(`photo.${'x'.repeat(300)}`);
    } finally {
      if (res.body.name) fs.rmSync(path.join(TEMP_UPLOAD_DIR, res.body.name), { force: true });
    }
  });
});

describe('второй колбэк multer — цепочка маршрута идёт один раз', () => {
  /** Запрос без тела в руках теста: multipart без границы — busboy откажет в конструкторе. */
  const unparsableRequest = () => {
    const req = new PassThrough();
    req.headers = { 'content-type': 'multipart/form-data', 'content-length': '1000' };
    req.method = 'POST';
    req.path = '/upload';
    return req;
  };

  test('отказ конструктора, потом закрытие соединения до конца тела', async () => {
    const middleware = createUpload({ storage: tempUploadStorage }).single('file');
    const req = unparsableRequest();
    const next = jest.fn();

    middleware(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400, code: 'INVALID_FORMAT' });

    // Соединение рвётся: multer слышит 'close' и снова зовёт колбэк.
    req.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'Upload parser called back again after its answer',
      expect.objectContaining({ reason: 'Request closed' }),
    );
  });
});

describe('неудачная уборка после отказа формы — в журнал', () => {
  /** Хранилище, которое «пишет» файл и не может его убрать. */
  const storageFailingRemoval = (failure) => ({
    _handleFile: (req, file, cb) => {
      file.stream.on('end', () => cb(null, { path: '/tmp/never-written', size: 3 }));
      file.stream.resume();
    },
    _removeFile: (req, file, cb) => cb(failure),
  });

  const appWith = (storage) => {
    const app = express();
    app.post('/upload', createUpload({ storage }).single('file'), (req, res) => res.json({}));
    app.use(errorHandler);
    return app;
  };

  // Второй файл в поле .single — LIMIT_UNEXPECTED_FILE: multer убирает первый.
  const twoFiles = (app) => request(app)
    .post('/upload')
    .attach('file', Buffer.from('one'), { filename: 'a.png', contentType: 'image/png' })
    .attach('file', Buffer.from('two'), { filename: 'b.png', contentType: 'image/png' });

  test('ошибка удаления — warn с путём и текстом', async () => {
    const failure = Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM', path: 'C:\\tmp\\uploads\\stuck.png' });
    const res = await twoFiles(appWith(storageFailingRemoval(failure)));

    expect(res.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledWith('Failed to remove temp upload of an aborted form', expect.objectContaining({
      reason: 'LIMIT_UNEXPECTED_FILE',
      failures: [{ path: 'C:\\tmp\\uploads\\stuck.png', error: 'EPERM: operation not permitted, unlink' }],
    }));
  });

  test('файла уже нет (ENOENT) — молчит', async () => {
    const gone = Object.assign(new Error('ENOENT: no such file or directory, unlink'), { code: 'ENOENT' });
    const res = await twoFiles(appWith(storageFailingRemoval(gone)));

    expect(res.status).toBe(400);
    expect(logger.warn.mock.calls.map(([message]) => message)).not.toContain('Failed to remove temp upload of an aborted form');
  });
});

// Предел облака — одно число в настройке (CLOUDINARY_MAX_FILE_MB), по
// умолчанию 10; неверное значение — умолчание и запись в журнал (ревью
// Phase 3.5, обычное L2 и линза NIT 3).
describe('предел облака из настройки', () => {
  test.each([
    [undefined, 10],
    ['', 10],
    ['  ', 10],
    ['20', 20],
    [' 40 ', 40],
  ])('%p → %p МБ, без записи в журнал', (raw, mb) => {
    expect(parseCloudMaxFileMb(raw)).toBe(mb);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test.each(['0', '-5', '15.5', '20MB', '1e3', '0x14', 'abc', '99999999999999999999'])(
    '%p — умолчание 10 и запись в журнал',
    (raw) => {
      expect(parseCloudMaxFileMb(raw)).toBe(10);
      expect(logger.warn).toHaveBeenCalledWith(
        'CLOUDINARY_MAX_FILE_MB is not a whole number of megabytes; the default is used',
        expect.objectContaining({ value: raw, defaultMb: 10 }),
      );
    },
  );

  test('граница предела по умолчанию: 10 МБ проходят, на байт больше — нет', () => {
    expect(CLOUD_MAX_FILE_MB).toBe(10);
    expect(fitsCloudFileLimit(10 * 1024 * 1024)).toBe(true);
    expect(fitsCloudFileLimit(10 * 1024 * 1024 + 1)).toBe(false);
  });
});
