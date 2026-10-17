/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Суточный предел загрузок — общий для всех загрузчиков (services/
 * uploadAllowance.js; слово Координатора 17.10.2026 «Согласен со всеми
 * рекомендациями по PR #54… 1 отдать той же ветви после слияния»).
 *
 * PR #54 поставил предел на загрузку в мастере. Медиа карточки (сайт в правке
 * карточки), картинка акции и аватар отправляли файлы в облако без него —
 * через них предел обходился. Теперь все четыре тратят один счётчик учётки:
 * 100 файлов и 300 МБ за минские сутки (дому сида 1000 и 3 ГБ — держит
 * daily-upload-allowance.test.js). Отказ — 429 RATE_LIMIT_EXCEEDED, тот же
 * текст, подробности и Retry-After (теперь их шлёт errorHandler).
 *
 * Ожидания — литералы утверждённых чисел и текста. Через настоящее приложение
 * и настоящий Redis; счётчик дня ставится прямо перед границей; облако
 * подменено (SDK — настоящие обёртки config/cloudinary.js вызываются).
 */

import { jest } from '@jest/globals';
import { readdirSync } from 'fs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { v2 as cloudinarySdk } from 'cloudinary';
import redisClient, { connectRedis } from '../../config/redis.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens, createTestEstablishment } from '../utils/auth.js';

// Общий лимитер читает свои числа при загрузке модуля — выше, чем шлёт этот
// файл, чтобы отвечал только суточный предел, а не настройки машины.
process.env.RATE_LIMIT_AUTHENTICATED = '1000';
process.env.RATE_LIMIT_WINDOW_AUTHENTICATED = '60';
const { default: app } = await import('../../server.js');
const { dailyUploadKeys } = await import('../../services/uploadAllowance.js');
const { TEMP_UPLOAD_DIR } = await import('../../middleware/upload.js');

const MB = 1024 * 1024;
const DAILY_LIMIT_TEXT = 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // 16 байт
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake\n'); // 15 байт

/** Полдень в Минске (UTC+3). */
const MINSK_NOON = Date.parse('2026-10-17T09:00:00.000Z');
const realNow = Date.now;

/** С этого места Date.now идёт как обычно, но от момента `originMs`. */
const startClockAt = (originMs) => {
  const realStart = realNow.call(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => originMs + (realNow.call(Date) - realStart));
};

/** С этого места Date.now стоит на `originMs`. */
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

const newAccount = async (role = 'partner') => {
  const { user, accessToken } = await createUserAndGetTokens({
    email: `uploaders-${randomUUID()}@test.com`,
    password: 'Partner123!@#',
    name: 'Проверка предела',
    role,
  });
  return { id: user.id, token: accessToken };
};

/** Партнёр с карточкой. */
const newPartnerWithCard = async () => {
  const partner = await newAccount('partner');
  const establishment = await createTestEstablishment(partner.id);
  return { ...partner, establishmentId: establishment.id };
};

const cardMedia = (account) => request(app)
  .post(`/api/v1/partner/establishments/${account.establishmentId}/media`)
  .set('Authorization', `Bearer ${account.token}`)
  .field('type', 'interior')
  .attach('file', PNG_BYTES, { filename: 'hall.jpg', contentType: 'image/jpeg' });

const cardMenuPdf = (account) => request(app)
  .post(`/api/v1/partner/establishments/${account.establishmentId}/media`)
  .set('Authorization', `Bearer ${account.token}`)
  .field('type', 'menu')
  .attach('file', PDF_BYTES, { filename: 'menu.pdf', contentType: 'application/pdf' });

const wizardUpload = (account) => request(app)
  .post('/api/v1/partner/media/upload')
  .set('Authorization', `Bearer ${account.token}`)
  .field('type', 'interior')
  .attach('file', PNG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

const createPromotion = (account, { withImage = true } = {}) => {
  const req = request(app)
    .post('/api/v1/partner/promotions')
    .set('Authorization', `Bearer ${account.token}`)
    .field('establishment_id', account.establishmentId)
    .field('title', 'Бизнес-ланч 15 BYN');
  return withImage ? req.attach('image', PNG_BYTES, { filename: 'promo.jpg', contentType: 'image/jpeg' }) : req;
};

const updatePromotionImage = (account, promotionId) => request(app)
  .patch(`/api/v1/partner/promotions/${promotionId}`)
  .set('Authorization', `Bearer ${account.token}`)
  .attach('image', PNG_BYTES, { filename: 'promo-2.jpg', contentType: 'image/jpeg' });

const avatar = (account) => request(app)
  .post('/api/v1/auth/avatar')
  .set('Authorization', `Bearer ${account.token}`)
  .attach('avatar', PNG_BYTES, { filename: 'me.jpg', contentType: 'image/jpeg' });

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

const countOf = async (sql, params) => (await query(sql, params)).rows[0].n;

/**
 * Выполнить запрос и убедиться, что временных файлов, появившихся за время
 * запроса, не осталось (удаление не обязано закончиться до ответа — ждём его).
 */
const leavesNoTempFile = async (send) => {
  const present = new Set(readdirSync(TEMP_UPLOAD_DIR));
  const res = await send();
  const deadline = realNow.call(Date) + 2000;
  const leftovers = () => readdirSync(TEMP_UPLOAD_DIR).filter((name) => !present.has(name));
  while (leftovers().length > 0 && realNow.call(Date) < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(leftovers()).toEqual([]);
  return res;
};

/** Отказ предела, как его шлёт любой загрузчик: текст, код, подробности, Retry-After. */
const expectDailyLimitRefusal = (res) => {
  expect(res.status).toBe(429);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toBe(DAILY_LIMIT_TEXT);
  expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  expect(res.body.error.details).toEqual(expect.objectContaining({ files_limit: 100, bytes_limit: 300 * MB }));
  expect(Number(res.headers['retry-after'])).toBe(res.body.error.details.retry_after);
};

describe('медиа карточки (POST /partner/establishments/:id/media)', () => {
  test('100-й файл дня ложится в карточку, 101-й — отказ; облако и карточка не тронуты', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 99, bytes: 5 * MB });

    const last = await cardMedia(partner);
    expect(last.status).toBe(201);
    expect(await counters(partner)).toEqual({ files: 100, bytes: 5 * MB + PNG_BYTES.length });

    const extra = await leavesNoTempFile(() => cardMedia(partner));
    expectDailyLimitRefusal(extra);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
    expect(await countOf(
      'SELECT COUNT(*)::int AS n FROM establishment_media WHERE establishment_id = $1',
      [partner.establishmentId],
    )).toBe(1);
    expect(await counters(partner)).toEqual({ files: 100, bytes: 5 * MB + PNG_BYTES.length });
  });

  test('полночь Минска — в отказе: Retry-After 43200 в полдень, reset_at 21:00 UTC', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 100 });

    freezeClockAt(MINSK_NOON);
    const res = await cardMedia(partner);

    expectDailyLimitRefusal(res);
    expect(res.headers['retry-after']).toBe('43200');
    expect(res.body.error.details).toEqual({
      files_limit: 100,
      bytes_limit: 300 * MB,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
    });
  });

  test('PDF меню на пределе — отказ, облако не зовётся', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 100 });

    expectDailyLimitRefusal(await leavesNoTempFile(() => cardMenuPdf(partner)));
    expect(cloudUpload).not.toHaveBeenCalled();
    expect(await countOf(
      'SELECT COUNT(*)::int AS n FROM ocr_jobs WHERE establishment_id = $1',
      [partner.establishmentId],
    )).toBe(0);
  });

  test('чужая карточка на пределе — «не найдено» (404), а не отказ предела; счётчики прежние', async () => {
    const stranger = await newPartnerWithCard();
    const owner = await newPartnerWithCard();
    await spentToday(stranger, { files: 100, bytes: 9 });

    const res = await cardMedia({ ...stranger, establishmentId: owner.establishmentId });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    expect(await counters(stranger)).toEqual({ files: 100, bytes: 9 });
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('файл не того формата при одном свободном месте — 422, место остаётся', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 99, bytes: 9 });

    const res = await request(app)
      .post(`/api/v1/partner/establishments/${partner.establishmentId}/media`)
      .set('Authorization', `Bearer ${partner.token}`)
      .field('type', 'interior')
      .attach('file', PNG_BYTES, { filename: 'hall.gif', contentType: 'image/png' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(await counters(partner)).toEqual({ files: 99, bytes: 9 });
    expect((await cardMedia(partner)).status).toBe(201);
  });

  test('облако отказало в файле (400) — резерв возвращается; исход неизвестен (502) — остаётся', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 99, bytes: 7 });

    cloudUpload.mockRejectedValueOnce({ message: 'Invalid image file', http_code: 400 });
    expect((await cardMedia(partner)).status).toBe(500);
    expect(await counters(partner)).toEqual({ files: 99, bytes: 7 });

    cloudUpload.mockRejectedValueOnce({ message: 'Server returned unexpected status code - 502', http_code: 502, name: 'UnexpectedResponse' });
    expect((await cardMedia(partner)).status).toBe(500);
    expect(await counters(partner)).toEqual({ files: 100, bytes: 7 + PNG_BYTES.length });

    expectDailyLimitRefusal(await cardMedia(partner));
  });
});

describe('один счётчик на все загрузчики', () => {
  test('100-й файл ушёл через мастер — медиа карточки, акция и аватар той же учётки получают отказ', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 99 });

    expect((await wizardUpload(partner)).status).toBe(201);

    expectDailyLimitRefusal(await cardMedia(partner));
    expectDailyLimitRefusal(await createPromotion(partner));
    expectDailyLimitRefusal(await avatar(partner));
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });

  test('и обратно: загрузки карточки, акции и аватара видны мастеру', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 97 });

    expect((await cardMedia(partner)).status).toBe(201);
    expect((await createPromotion(partner)).status).toBe(201);
    expect((await avatar(partner)).status).toBe(200);
    expect((await counters(partner)).files).toBe(100);

    expectDailyLimitRefusal(await wizardUpload(partner));
  });
});

describe('картинка акции (POST и PATCH /partner/promotions)', () => {
  test('три действующие акции и картинка на пределе — отказ потолка акций (400), а не предела', async () => {
    const partner = await newPartnerWithCard();
    for (let i = 0; i < 3; i += 1) {
      expect((await createPromotion(partner, { withImage: false })).status).toBe(201);
    }
    await spentToday(partner, { files: 100, bytes: 9 });

    const res = await createPromotion(partner);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROMOTION_LIMIT_EXCEEDED');
    expect(await counters(partner)).toEqual({ files: 100, bytes: 9 });
    expect(cloudUpload).not.toHaveBeenCalled();
  });

  test('на пределе акция с картинкой — отказ, акция не создана; без картинки — создаётся', async () => {
    const partner = await newPartnerWithCard();
    await spentToday(partner, { files: 100 });

    expectDailyLimitRefusal(await leavesNoTempFile(() => createPromotion(partner)));
    expect(await countOf(
      'SELECT COUNT(*)::int AS n FROM promotions WHERE establishment_id = $1',
      [partner.establishmentId],
    )).toBe(0);

    const withoutImage = await createPromotion(partner, { withImage: false });
    expect(withoutImage.status).toBe(201);
    expect(cloudUpload).not.toHaveBeenCalled();
    expect((await counters(partner)).files).toBe(100);
  });

  test('на пределе новая картинка акции — отказ, у акции прежняя картинка', async () => {
    const partner = await newPartnerWithCard();
    const created = await createPromotion(partner);
    expect(created.status).toBe(201);
    const promotionId = created.body.data.id;
    const before = (await query('SELECT image_url FROM promotions WHERE id = $1', [promotionId])).rows[0].image_url;
    expect(before).toEqual(expect.stringContaining('promotions'));

    await spentToday(partner, { files: 100 });
    expectDailyLimitRefusal(await updatePromotionImage(partner, promotionId));

    const after = (await query('SELECT image_url FROM promotions WHERE id = $1', [promotionId])).rows[0].image_url;
    expect(after).toBe(before);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });
});

describe('аватар (POST /auth/avatar)', () => {
  test('файл не того формата на пределе — отказ формата (400), а не предела', async () => {
    const guest = await newAccount('user');
    await spentToday(guest, { files: 100 });

    const res = await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${guest.token}`)
      .attach('avatar', PNG_BYTES, { filename: 'me.gif', contentType: 'image/gif' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect((await counters(guest)).files).toBe(100);
  });

  test('ниже предела — загружается и тратит файл; на пределе — отказ, аватар прежний', async () => {
    const guest = await newAccount('user');
    await spentToday(guest, { files: 99, bytes: 3 });

    expect((await avatar(guest)).status).toBe(200);
    expect(await counters(guest)).toEqual({ files: 100, bytes: 3 + PNG_BYTES.length });
    const before = (await query('SELECT avatar_url FROM users WHERE id = $1', [guest.id])).rows[0].avatar_url;

    expectDailyLimitRefusal(await leavesNoTempFile(() => avatar(guest)));
    const after = (await query('SELECT avatar_url FROM users WHERE id = $1', [guest.id])).rows[0].avatar_url;
    expect(after).toBe(before);
    expect(cloudUpload).toHaveBeenCalledTimes(1);
  });

  test('облако отказало в аватаре (400) — резерв возвращается; таймаут SDK — остаётся', async () => {
    const guest = await newAccount('user');
    await spentToday(guest, { files: 50, bytes: 9 });

    cloudUpload.mockRejectedValueOnce({ message: 'Invalid image file', http_code: 400 });
    expect((await avatar(guest)).status).toBe(500);
    expect(await counters(guest)).toEqual({ files: 50, bytes: 9 });

    cloudUpload.mockRejectedValueOnce({ error: { message: 'Request Timeout', http_code: 499, name: 'TimeoutError' } });
    expect((await avatar(guest)).status).toBe(500);
    expect(await counters(guest)).toEqual({ files: 51, bytes: 9 + PNG_BYTES.length });
  });
});
