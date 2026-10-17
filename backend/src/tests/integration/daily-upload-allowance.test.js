/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Суточный предел загрузок на учётку — POST /api/v1/partner/media/upload
 * (services/uploadAllowance.js; слово Координатора 17.10.2026 «по твоей
 * рекомендации»).
 *
 * До правки между одной учёткой и месячной квотой облака стоял только общий
 * лимитер — 100 запросов в минуту: каждая загрузка ложится в Cloudinary
 * навсегда, а тариф бесплатный (25 кредитов за скользящие 30 дней, кредит —
 * около гигабайта хранения или тысячи обработок).
 *
 * Ожидания — литералы рекомендованных чисел и предложенного текста: обычная
 * учётка — 100 файлов и 300 МБ за минские сутки, дом сида (признак
 * is_service_account) — 1000 файлов и 3 ГБ; отказ — 429 с кодом
 * RATE_LIMIT_EXCEEDED, как у всех пределов. Каждая граница — парой: последняя
 * разрешённая загрузка и первая лишняя.
 *
 * Через настоящее приложение и настоящий Redis. Сотни загрузок за тест не
 * гоняются: счётчик дня ставится в Redis прямо перед границей. Облако
 * подменено. Часы подменены и идут от заданного момента (токены выпускаются по
 * тем же часам); где проверяется секунда до полуночи — часы стоят.
 */

import { jest } from '@jest/globals';
import { readdirSync } from 'fs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { v2 as cloudinarySdk } from 'cloudinary';
import redisClient, { connectRedis } from '../../config/redis.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

// Общий лимитер читает свои числа при загрузке модуля — выше, чем шлёт этот
// файл, чтобы отвечал только суточный предел, а не настройки машины.
process.env.RATE_LIMIT_AUTHENTICATED = '1000';
process.env.RATE_LIMIT_WINDOW_AUTHENTICATED = '60';
const { default: app } = await import('../../server.js');
const { dailyUploadKeys } = await import('../../services/uploadAllowance.js');
const { TEMP_UPLOAD_DIR } = await import('../../middleware/upload.js');

const URL = '/api/v1/partner/media/upload';
const MB = 1024 * 1024;
const DAILY_LIMIT_TEXT = 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.';
const UPLOAD_FAILED_TEXT = 'Не удалось загрузить файл. Попробуйте ещё раз через минуту.';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // 16 байт
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake\n'); // 15 байт

/** Полдень в Минске (UTC+3) — далеко от границы суток. */
const MINSK_NOON = Date.parse('2026-10-17T09:00:00.000Z');

const realNow = Date.now;

/** С этого места Date.now идёт как обычно, но от момента `originMs`. */
const startClockAt = (originMs) => {
  const realStart = realNow.call(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => originMs + (realNow.call(Date) - realStart));
};

/**
 * С этого места Date.now стоит на `originMs`: проверка точной секунды до
 * полуночи не зависит от того, сколько длится запрос.
 */
const freezeClockAt = (originMs) => {
  jest.spyOn(Date, 'now').mockImplementation(() => originMs);
};

let cloudUpload;

const sweepAllowanceKeys = async () => {
  const keys = await redisClient.keys('uploads:daily:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required for the daily upload allowance tests');
    }
  }
  await clearAllData();
});

beforeEach(async () => {
  startClockAt(MINSK_NOON);
  await sweepAllowanceKeys();
  cloudUpload = jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => {
    const id = randomUUID();
    return {
      public_id: `${options.folder}/${id}`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/${id}.jpg`,
      width: 800,
      height: 600,
      format: 'jpg',
      bytes: 2048,
      pages: 1,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (redisClient.isReady) {
    await sweepAllowanceKeys();
  }
  await clearAllData();
});

/** Новая учётка; токен выпущен по подменённым часам. */
const newAccount = async ({ role = 'partner', service = false } = {}) => {
  const { user, accessToken } = await createUserAndGetTokens({
    email: `allowance-${randomUUID()}@test.com`,
    password: 'Partner123!@#',
    name: 'Проверка предела',
    role,
  });
  if (service) {
    await query('UPDATE users SET is_service_account = true WHERE id = $1', [user.id]);
  }
  return { id: user.id, token: accessToken };
};

const upload = (account, { bytes = PNG_BYTES, filename = 'photo.jpg', contentType = 'image/jpeg', type = 'interior' } = {}) =>
  request(app)
    .post(URL)
    .set('Authorization', `Bearer ${account.token}`)
    .field('type', type)
    .attach('file', bytes, { filename, contentType });

/** Счётчики дня учётки — на момент подменённых часов. */
const keysOf = (account) => dailyUploadKeys(account.id, new Date(Date.now()));

/** Поставить счётчики дня так, будто сегодня уже загружено `files` файлов и `bytes` байт. */
const spentToday = async (account, { files = 0, bytes = 0 }) => {
  const keys = keysOf(account);
  await redisClient.set(keys.files, String(files), { EX: 3600 });
  await redisClient.set(keys.bytes, String(bytes), { EX: 3600 });
};

const counters = async (account) => {
  const keys = keysOf(account);
  return {
    files: Number(await redisClient.get(keys.files)),
    bytes: Number(await redisClient.get(keys.bytes)),
  };
};

const expectDailyLimitRefusal = (res) => {
  expect(res.status).toBe(429);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toBe(DAILY_LIMIT_TEXT);
  expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
};

const waitFor = async (check, ms = 2000) => {
  const deadline = realNow.call(Date) + ms;
  while (realNow.call(Date) < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
};

describe('обычная учётка: 100 файлов в сутки', () => {
  test('100-й файл дня загружается, 101-й — отказ с текстом; отказ ничего не тратит и не оставляет файла', async () => {
    const account = await newAccount({ role: 'user' });
    await spentToday(account, { files: 99, bytes: 99 * MB });

    const last = await upload(account);
    expect(last.status).toBe(201);
    expect(cloudUpload).toHaveBeenCalledTimes(1);

    const present = new Set(readdirSync(TEMP_UPLOAD_DIR));
    const extra = await upload(account);
    expectDailyLimitRefusal(extra);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
    // Отказ вернул свой резерв: на счётчиках только принятое.
    expect(await counters(account)).toEqual({ files: 100, bytes: 99 * MB + PNG_BYTES.length });
    // Временный файл отказанной загрузки удалён (удаление не ждёт ответа — ждём его).
    const leftovers = () => readdirSync(TEMP_UPLOAD_DIR).filter((name) => !present.has(name));
    expect(await waitFor(() => leftovers().length === 0)).toBe(true);
  });

  test('отказ называет полночь Минска: Retry-After, retry_after и reset_at', async () => {
    const account = await newAccount();
    await spentToday(account, { files: 100 });

    freezeClockAt(MINSK_NOON);
    const res = await upload(account);

    expectDailyLimitRefusal(res);
    // Полдень Минска: до полуночи 12 ч; полночь Минска — 21:00 UTC.
    expect(res.headers['retry-after']).toBe('43200');
    expect(res.body.error.details).toEqual({
      files_limit: 100,
      bytes_limit: 300 * MB,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
    });
  });

  test('PDF меню считается тем же пределом', async () => {
    const account = await newAccount();
    await spentToday(account, { files: 100 });

    const res = await upload(account, { bytes: PDF_BYTES, filename: 'menu.pdf', contentType: 'application/pdf', type: 'menu' });

    expectDailyLimitRefusal(res);
    expect(cloudUpload).not.toHaveBeenCalled();
  });
});

describe('обычная учётка: 300 МБ в сутки', () => {
  test('файл, с которым набирается ровно 300 МБ, загружается; следующий байт — отказ', async () => {
    const account = await newAccount();
    await spentToday(account, { files: 10, bytes: 300 * MB - PNG_BYTES.length });

    const exact = await upload(account);
    expect(exact.status).toBe(201);
    expect(await counters(account)).toEqual({ files: 11, bytes: 300 * MB });

    const oneByteOver = await upload(account, { bytes: Buffer.from([0xff]) });
    expectDailyLimitRefusal(oneByteOver);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
    expect(await counters(account)).toEqual({ files: 11, bytes: 300 * MB });
  });
});

describe('дом сида (служебная учётка): свой предел — 1000 файлов и 3 ГБ', () => {
  test('за обычным пределом служебная загружает, обычная — нет', async () => {
    const seedHouse = await newAccount({ service: true });
    const partner = await newAccount();
    await spentToday(seedHouse, { files: 100, bytes: 300 * MB });
    await spentToday(partner, { files: 100, bytes: 300 * MB });

    expect((await upload(seedHouse)).status).toBe(201);
    expectDailyLimitRefusal(await upload(partner));
  });

  test('1000-й файл дня загружается, 1001-й — отказ', async () => {
    const seedHouse = await newAccount({ service: true });
    await spentToday(seedHouse, { files: 999 });

    expect((await upload(seedHouse)).status).toBe(201);
    const extra = await upload(seedHouse);
    expectDailyLimitRefusal(extra);
    expect(extra.body.error.details.files_limit).toBe(1000);
    expect(extra.body.error.details.bytes_limit).toBe(3 * 1024 * MB);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });

  test('ровно 3 ГБ загружается, следующий байт — отказ', async () => {
    const seedHouse = await newAccount({ service: true });
    await spentToday(seedHouse, { files: 10, bytes: 3 * 1024 * MB - PNG_BYTES.length });

    expect((await upload(seedHouse)).status).toBe(201);
    expectDailyLimitRefusal(await upload(seedHouse, { bytes: Buffer.from([0xff]) }));
  });
});

describe('чей счётчик и какого дня', () => {
  test('учётки не делят счётчик: исчерпанный предел одной не мешает другой', async () => {
    const spent = await newAccount();
    const fresh = await newAccount();
    await spentToday(spent, { files: 100 });

    expectDailyLimitRefusal(await upload(spent));
    expect((await upload(fresh)).status).toBe(201);
  });

  test('сутки — минские: в 23:59:58 по Минску отказ, в 00:00:02 — загрузка', async () => {
    // Токен выпущен в тот же вечер: до запросов проходит меньше его срока.
    startClockAt(Date.parse('2026-10-17T20:59:00.000Z'));
    const account = await newAccount();
    freezeClockAt(Date.parse('2026-10-17T20:59:58.000Z'));
    await spentToday(account, { files: 100 });

    const lateEvening = await upload(account);
    expectDailyLimitRefusal(lateEvening);
    expect(lateEvening.body.error.details.retry_after).toBe(2);
    expect(lateEvening.body.error.details.reset_at).toBe('2026-10-17T21:00:00.000Z');

    // Четыре секунды спустя: в Минске уже 18.10, в UTC всё ещё 17.10.
    freezeClockAt(Date.parse('2026-10-17T21:00:02.000Z'));
    const nextDay = await upload(account);
    expect(nextDay.status).toBe(201);
  });
});

describe('что не тратит предел', () => {
  test('файл, отклонённый проверкой, предела не тратит', async () => {
    const account = await newAccount();
    await spentToday(account, { files: 99 });

    const refused = await upload(account, { filename: 'photo.gif', contentType: 'image/png' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('INVALID_FILE_TYPE');

    expect((await upload(account)).status).toBe(201);
  });

  test.each([
    ['фото', { bytes: PNG_BYTES }],
    ['PDF меню', { bytes: PDF_BYTES, filename: 'menu.pdf', contentType: 'application/pdf', type: 'menu' }],
  ])('облако отказало в файле (ответ 400), %s — резерв возвращается, тот же файл можно загрузить снова', async (_label, file) => {
    const account = await newAccount();
    await spentToday(account, { files: 99, bytes: 7 });
    // Так SDK отклоняет загрузку, на которую облако ответило ошибкой.
    cloudUpload.mockRejectedValueOnce({ message: 'Invalid image file', http_code: 400 });

    const failed = await upload(account, file);
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe(UPLOAD_FAILED_TEXT);
    expect(await counters(account)).toEqual({ files: 99, bytes: 7 });

    expect((await upload(account, file)).status).toBe(201);
    expect(cloudUpload).toHaveBeenCalledTimes(2);
  });
});

describe('исход облака неизвестен — резерв остаётся: файл мог сохраниться', () => {
  test.each([
    ['таймаут SDK (499)', { error: { message: 'Request Timeout', http_code: 499, name: 'TimeoutError' } }],
    ['ответ шлюза 502', { message: 'Server returned unexpected status code - 502', http_code: 502, name: 'UnexpectedResponse' }],
    ['обрыв соединения', { error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }],
  ])('%s: последнее место дня потрачено, следующая загрузка — отказ', async (_label, rejection) => {
    const account = await newAccount();
    await spentToday(account, { files: 99, bytes: 7 });
    cloudUpload.mockRejectedValueOnce(rejection);

    const failed = await upload(account);
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe(UPLOAD_FAILED_TEXT);
    expect(await counters(account)).toEqual({ files: 100, bytes: 7 + PNG_BYTES.length });

    expectDailyLimitRefusal(await upload(account));
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });
});

describe('одновременные загрузки у границы', () => {
  test('один свободный файл и четыре загрузки разом — в облако уходит ровно одна', async () => {
    const account = await newAccount();
    await spentToday(account, { files: 99 });
    const cloudDone = cloudUpload.getMockImplementation();
    cloudUpload.mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return cloudDone(...args);
    });

    const results = await Promise.all([1, 2, 3, 4].map(() => upload(account)));

    expect(results.map((res) => res.status).sort()).toEqual([201, 429, 429, 429]);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
    expect((await counters(account)).files).toBe(100);
  });
});

describe('Redis недоступен', () => {
  test('загрузка идёт без предела, как у лимитеров', async () => {
    const account = await newAccount();
    await spentToday(account, { files: 100 });
    expectDailyLimitRefusal(await upload(account));

    await redisClient.disconnect();
    try {
      const res = await upload(account);
      expect(res.status).toBe(201);
      expect(cloudUpload).toHaveBeenCalledTimes(1);
    } finally {
      await connectRedis();
    }
  });
});
