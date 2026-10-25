/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отказы разбора тела запроса (server.js, express.json / express.urlencoded;
 * находки 13 и 16 инцидента Railway, 25.10.2026):
 *  - сжатое тело не распаковывается — отказ 415 UNSUPPORTED_ENCODING; ни один
 *    наш клиент (приложение, панель, сайт) сжатых тел не шлёт. До правки
 *    тело распаковывалось до разбора, и предел 10 МБ считался по
 *    распакованному;
 *  - отказы разбора тела — русский текст и свой код (не INTERNAL_ERROR с
 *    английским текстом библиотеки, как до правки): слишком большое —
 *    413 PAYLOAD_TOO_LARGE, неподдерживаемая кодировка — 415
 *    UNSUPPORTED_CHARSET, форма, которую сервер не читает (слишком много
 *    полей, слишком глубокая вложенность), — 400 INVALID_FORMAT с текстом
 *    нечитаемой формы;
 *  - обычные тела разбираются, как прежде, — и ровно на пределе.
 *
 * Тела — сырые байты через node:http: supertest шлёт Buffer с типом JSON как
 * JSON-объект {"type":"Buffer",…}, сжатое или «ровно 10 МБ» он не пошлёт.
 * Разобрано ли тело, видно по стражу запроса: NUL в разобранном теле — его
 * отказ 400 (BODY_NUL_MESSAGE) на любом пути /api; тело, отклонённое
 * разборщиком, до стража не доходит.
 *
 * Попутно (находка 14): аватар больше предела — прежний отказ маршрута
 * (400 FILE_TOO_LARGE), и во временной папке не остаётся недописанного файла.
 *
 * Ожидаемые тексты — литералы.
 */

import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import redisClient, { connectRedis } from '../../config/redis.js';
import logger from '../../utils/logger.js';
import { BODY_NUL_MESSAGE } from '../../middleware/requestGuard.js';
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

const TOO_LARGE = { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Запрос слишком большой — не больше 10 МБ.' };
const COMPRESSED = { status: 415, code: 'UNSUPPORTED_ENCODING', message: 'Сжатые тела запросов не принимаются.' };
const CHARSET = { status: 415, code: 'UNSUPPORTED_CHARSET', message: 'Кодировка запроса не поддерживается.' };
const FORM_NOT_READ = {
  status: 400,
  code: 'INVALID_FORMAT',
  message: 'Не удалось прочитать отправленные данные. Попробуйте ещё раз.',
};
const PARSED = { status: 400, code: 'INVALID_FORMAT', message: BODY_NUL_MESSAGE };

const LIMIT = 10 * 1024 * 1024;
const JSON_TYPE = 'application/json';
const FORM_TYPE = 'application/x-www-form-urlencoded';

/** JSON с NUL в значении ровно в `size` байт. */
const jsonOfSize = (size) => {
  const shell = '{"a":"\\u0000"}';
  return Buffer.from(`{"a":"${'x'.repeat(size - shell.length)}\\u0000"}`);
};
/** Форма с NUL в значении ровно в `size` байт. */
const formOfSize = (size) => Buffer.from(`a=${'x'.repeat(size - 'a=%00'.length)}%00`);

const SMALL_JSON = Buffer.from('{"a":"x\\u0000"}');
const SMALL_FORM = Buffer.from('a=x%00');

let server;
let port;

/**
 * POST сырых байтов. Без `chunked` — с Content-Length; с `chunked` — без
 * него, кусками по 1 МБ (Transfer-Encoding: chunked).
 */
const send = ({ body, type = JSON_TYPE, headers = {}, chunked = false, path = '/api/v1/body-probe' }) =>
  new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path,
      headers: {
        'Content-Type': type,
        ...(chunked ? {} : { 'Content-Length': body.length }),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve({ status: res.statusCode, code: parsed.error?.code, message: parsed.message });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (!chunked) {
      req.end(body);
      return;
    }
    for (let at = 0; at < body.length; at += 1024 * 1024) {
      req.write(body.subarray(at, at + 1024 * 1024));
    }
    req.end();
  });

const sweepRateLimitKeys = async () => {
  const keys = await redisClient.keys('ratelimit:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

let warn;
let error;

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required: the global limiter stands before the body parsers');
    }
  }
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  ({ port } = server.address());
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await sweepRateLimitKeys();
});

beforeEach(async () => {
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  await sweepRateLimitKeys();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('обычные тела разбираются, как прежде', () => {
  test('JSON и форма без сжатия — разобраны (отказ стража по NUL в разобранном теле)', async () => {
    expect(await send({ body: SMALL_JSON })).toEqual(PARSED);
    expect(await send({ body: SMALL_FORM, type: FORM_TYPE })).toEqual(PARSED);
    expect(await send({ body: SMALL_JSON, type: `${JSON_TYPE}; charset=utf-8` })).toEqual(PARSED);
  });

  test('Content-Encoding: identity — тело не сжато, разобрано', async () => {
    expect(await send({ body: SMALL_JSON, headers: { 'Content-Encoding': 'identity' } })).toEqual(PARSED);
  });

  test('неразборчивый JSON — прежний отказ 400 INVALID_JSON', async () => {
    const res = await send({ body: Buffer.from('{"a":') });

    expect([res.status, res.code]).toEqual([400, 'INVALID_JSON']);
  });
});

describe('предел 10 МБ — русский отказ 413 PAYLOAD_TOO_LARGE', () => {
  test('JSON ровно 10 МБ разобран; на байт больше — 413', async () => {
    expect(await send({ body: jsonOfSize(LIMIT) })).toEqual(PARSED);
    expect(await send({ body: jsonOfSize(LIMIT + 1) })).toEqual(TOO_LARGE);
  });

  test('форма ровно 10 МБ разобрана; на байт больше — 413', async () => {
    expect(await send({ body: formOfSize(LIMIT), type: FORM_TYPE })).toEqual(PARSED);
    expect(await send({ body: formOfSize(LIMIT + 1), type: FORM_TYPE })).toEqual(TOO_LARGE);
  });

  test('без Content-Length (кусками) — тот же отказ', async () => {
    expect(await send({ body: jsonOfSize(LIMIT + 1), chunked: true })).toEqual(TOO_LARGE);
  });

  test('отказ клиенту — в журнале предупреждение, не ошибка сервера', async () => {
    await send({ body: jsonOfSize(LIMIT + 1) });

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Client error occurred',
      expect.objectContaining({ statusCode: 413, errorCode: 'PAYLOAD_TOO_LARGE' }),
    );
  });
});

describe('сжатое тело не распаковывается — 415 UNSUPPORTED_ENCODING', () => {
  test.each([
    ['gzip', zlib.gzipSync],
    ['deflate', zlib.deflateSync],
  ])('JSON и форма, %s — отказ, тело не разобрано', async (encoding, compress) => {
    const headers = { 'Content-Encoding': encoding };

    expect(await send({ body: compress(SMALL_JSON), headers })).toEqual(COMPRESSED);
    expect(await send({ body: compress(SMALL_FORM), type: FORM_TYPE, headers })).toEqual(COMPRESSED);
  });

  test('сжатое тело, распакованное больше предела, — тот же отказ 415', async () => {
    const body = zlib.gzipSync(jsonOfSize(LIMIT + 1));
    expect(body.length).toBeLessThan(LIMIT);

    expect(await send({ body, headers: { 'Content-Encoding': 'gzip' } })).toEqual(COMPRESSED);
  });

  test('в журнале — предупреждение с отклонённым Content-Encoding', async () => {
    await send({ body: zlib.gzipSync(SMALL_JSON), headers: { 'Content-Encoding': 'gzip' } });

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Client error occurred',
      expect.objectContaining({ statusCode: 415, errorCode: 'UNSUPPORTED_ENCODING', encoding: 'gzip' }),
    );
  });

  test('сжатие, которого разборщик и прежде не знал (br), — тот же отказ', async () => {
    const body = zlib.brotliCompressSync(SMALL_JSON);

    expect(await send({ body, headers: { 'Content-Encoding': 'br' } })).toEqual(COMPRESSED);
  });
});

describe('неподдерживаемая кодировка — 415 UNSUPPORTED_CHARSET', () => {
  test('JSON в koi8-r и форма в windows-1251 — отказ', async () => {
    expect(await send({ body: SMALL_JSON, type: `${JSON_TYPE}; charset=koi8-r` })).toEqual(CHARSET);
    expect(await send({ body: SMALL_FORM, type: `${FORM_TYPE}; charset=windows-1251` })).toEqual(CHARSET);
  });
});

describe('форма, которую сервер не читает, — 400 INVALID_FORMAT, текст нечитаемой формы', () => {
  test('больше 1000 полей — отказ; ровно 1000 — разобрана', async () => {
    const fields = (n) => Array.from({ length: n }, (_, i) => `f${i}=1`);

    expect(await send({ body: Buffer.from([...fields(999), 'a=%00'].join('&')), type: FORM_TYPE }))
      .toEqual(PARSED);
    expect(await send({ body: Buffer.from([...fields(1000), 'a=%00'].join('&')), type: FORM_TYPE }))
      .toEqual(FORM_NOT_READ);
  });

  test('вложенность имени глубже 32 — отказ; 32 — разобрана', async () => {
    const nested = (depth) => `a${'[b]'.repeat(depth)}=%00`;

    expect(await send({ body: Buffer.from(nested(32)), type: FORM_TYPE })).toEqual(PARSED);
    expect(await send({ body: Buffer.from(nested(33)), type: FORM_TYPE })).toEqual(FORM_NOT_READ);
  });
});

describe('аватар больше предела (находка 14) — недописанный файл не остаётся', () => {
  let token;

  beforeAll(async () => {
    await clearAllData();
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
    const user = await createUserAndGetTokens({
      email: `body-refusals-${Date.now()}@test.com`,
      password: 'User123!@#',
      name: 'Аватар больше предела',
    });
    token = user.accessToken;
  });

  afterAll(async () => {
    await clearAllData();
  });

  test.each([
    ['на байт больше 5 МБ', 5 * 1024 * 1024 + 1],
    ['8 МБ', 8 * 1024 * 1024],
  ])('%s — прежний отказ маршрута, временная папка как до запроса', async (_label, size) => {
    const before = new Set(fs.readdirSync(TEMP_UPLOAD_DIR));

    const res = await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', Buffer.alloc(size, 0xff), { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect([res.status, res.body.error?.code]).toEqual([400, 'FILE_TOO_LARGE']);
    expect(fs.readdirSync(TEMP_UPLOAD_DIR).filter((name) => !before.has(name))).toEqual([]);
  });
});
