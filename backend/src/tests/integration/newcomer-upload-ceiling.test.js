/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Общий потолок загрузок новых учёток (services/newcomerUploadCeiling.js;
 * нитка «2Г: общие пределы», п. 1.05, 10.11.2026) — через настоящее
 * приложение, настоящую базу и настоящий Redis.
 *
 * До правки учётка с подтверждённой почтой держала только свои 100 файлов в
 * сутки, и общего счёта у подтверждённых не было: несколько десятков
 * подтверждённых учёток выбирали бесплатный тариф облака за сутки-двое.
 *
 * Ожидания — литералы: потолок новых учёток — 200 файлов за минские сутки,
 * отказ — 429 RATE_LIMIT_EXCEEDED с прежним текстом суточного предела; партнёр
 * с карточкой в каталоге потолка не видит. Сотни загрузок не гоняются: счётчик
 * потолка ставится в Redis прямо перед границей. Облако подменено, часы идут от
 * минского полудня.
 */

import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { v2 as cloudinarySdk } from 'cloudinary';
import redisClient, { connectRedis } from '../../config/redis.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

// Общий лимитер читает свои числа при загрузке модуля — выше, чем шлёт файл.
process.env.RATE_LIMIT_AUTHENTICATED = '1000';
process.env.RATE_LIMIT_WINDOW_AUTHENTICATED = '60';
const { default: app } = await import('../../server.js');
const { newcomerAccountKeys, newcomersKeys } = await import('../../services/newcomerUploadCeiling.js');
const { uploadStanding } = await import('../../services/unconfirmedAllowance.js');

const URL = '/api/v1/partner/media/upload';
const DAILY_LIMIT_TEXT = 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** Полдень в Минске (UTC+3), 10.11.2026. */
const MINSK_NOON = Date.parse('2026-11-10T09:00:00.000Z');
const realNow = Date.now;

const sweep = async () => {
  const keys = [
    ...await redisClient.keys('uploads:daily:*'),
    ...await redisClient.keys('uploads:newcomers:*'),
    ...await redisClient.keys('unconfirmed:daily:*'),
  ];
  if (keys.length > 0) await redisClient.del(keys);
};

beforeAll(async () => {
  if (!redisClient.isReady && !await connectRedis()) {
    throw new Error('Redis connection is required for the upload ceiling tests');
  }
  await clearAllData();
});

beforeEach(async () => {
  const realStart = realNow.call(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => MINSK_NOON + (realNow.call(Date) - realStart));
  await sweep();
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_path, options) => {
    const id = randomUUID();
    return {
      public_id: `${options.folder}/${id}`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/${id}.jpg`,
      width: 800, height: 600, format: 'jpg', bytes: 2048, pages: 1,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (redisClient.isReady) await sweep();
  await clearAllData();
});

/** Учётка; `confirmed` — почта подтверждена; `card` — статус её карточки. */
const account = async ({ role = 'partner', confirmed = true, card = null, service = false } = {}) => {
  const { user, accessToken } = await createUserAndGetTokens({
    email: `ceiling-${randomUUID()}@test.com`,
    password: 'Partner123!@#',
    name: 'Проверка потолка',
    role,
  });
  if (confirmed) await query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]);
  if (service) await query('UPDATE users SET is_service_account = true WHERE id = $1', [user.id]);
  if (card) {
    const est = await createTestEstablishment(user.id);
    await query('UPDATE establishments SET status = $2 WHERE id = $1', [est.id, card]);
  }
  return { id: user.id, token: accessToken };
};

const upload = (who) => request(app)
  .post(URL)
  .set('Authorization', `Bearer ${who.token}`)
  .field('type', 'interior')
  .attach('file', PNG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

/** Счётчик файлов потолка новых учёток — будто сегодня загружено `files`. */
const ceilingSpent = async (files) => {
  await redisClient.set(newcomersKeys(new Date(Date.now())).files, String(files), { EX: 3600 });
};

describe('новые подтверждённые учётки делят 200 файлов в сутки', () => {
  test('200-й файл на всех проходит, 201-й — отказ другой учётке; её собственный запас не тронут', async () => {
    const first = await account();
    const second = await account();
    await ceilingSpent(199);

    const last = await upload(first);
    expect(last.status).toBe(201);

    const extra = await upload(second);
    expect(extra.status).toBe(429);
    expect(extra.body.message).toBe(DAILY_LIMIT_TEXT);
    expect(extra.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(extra.body.error.details).toEqual(expect.objectContaining({ files_limit: 200, ceiling: true }));
    expect(Number(await redisClient.get(newcomersKeys(new Date(Date.now())).files))).toBe(200);
    // Отказ вернул и свой резерв второй учётки.
    expect(await redisClient.get(`uploads:daily:${second.id}:2026-11-10:files`)).toBe('0');
  });

  test('одна учётка выбрала свою долю (40 файлов) — ей отказ, другая новая учётка грузит', async () => {
    const greedy = await account();
    const other = await account();
    await redisClient.set(newcomerAccountKeys(greedy.id, new Date(Date.now())).files, '40', { EX: 3600 });

    const refused = await upload(greedy);
    expect(refused.status).toBe(429);
    expect(refused.body.message).toBe(DAILY_LIMIT_TEXT);
    expect(refused.body.error.details).toEqual(expect.objectContaining({ files_limit: 40, ceiling: true }));

    expect((await upload(other)).status).toBe(201);
  });

  test('потолок выбран — партнёр с карточкой в каталоге и дом сида загружают как прежде', async () => {
    await ceilingSpent(200);
    const listed = await account({ card: 'active' });
    const seedHouse = await account({ service: true });

    expect((await upload(listed)).status).toBe(201);
    expect((await upload(seedHouse)).status).toBe(201);
  });

  test('карточка ещё на модерации — учётка всё ещё новая: потолок держит её', async () => {
    await ceilingSpent(200);
    const pending = await account({ card: 'pending' });

    const res = await upload(pending);
    expect(res.status).toBe(429);
    expect(res.body.error.details.ceiling).toBe(true);
  });

  test('день карточек новых выбран — гость с подтверждённой почтой меняет аватар: у аватаров свой счёт', async () => {
    await ceilingSpent(200);
    const guest = await account({ role: 'user' });

    const res = await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${guest.token}`)
      .attach('avatar', PNG_BYTES, { filename: 'avatar.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(Number(await redisClient.get(newcomersKeys(new Date(Date.now()), 'avatar').files))).toBe(1);
  });

  test('день аватаров новых выбран — гостю отказ с прежним текстом, загрузки карточек новых идут', async () => {
    await redisClient.set(newcomersKeys(new Date(Date.now()), 'avatar').files, '200', { EX: 3600 });
    const guest = await account({ role: 'user' });
    const partner = await account();

    const refused = await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${guest.token}`)
      .attach('avatar', PNG_BYTES, { filename: 'avatar.jpg', contentType: 'image/jpeg' });
    expect(refused.status).toBe(429);
    expect(refused.body.message).toBe(DAILY_LIMIT_TEXT);
    expect((await upload(partner)).status).toBe(201);
  });

  test('неподтверждённая учётка — в своём общем потолке, потолок новых её не держит', async () => {
    await ceilingSpent(200);
    const unconfirmed = await account({ confirmed: false });

    expect((await upload(unconfirmed)).status).toBe(201);
  });
});

describe('uploadStanding — кто в каком общем потолке, на настоящей базе', () => {
  test.each([
    ['почта не подтверждена', { confirmed: false }, 'unconfirmed'],
    ['почта подтверждена, карточки нет', {}, 'newcomer'],
    ['почта подтверждена, карточка на модерации', { card: 'pending' }, 'newcomer'],
    ['почта подтверждена, карточка снята модератором', { card: 'suspended' }, 'newcomer'],
    ['почта подтверждена, карточка в каталоге', { card: 'active' }, 'known'],
    ['дом сида', { service: true }, 'known'],
    ['панель: администратор', { role: 'admin' }, 'known'],
    ['панель: наблюдатель', { role: 'viewer' }, 'known'],
  ])('%s — %s', async (_label, options, standing) => {
    const who = await account(options);

    expect(await uploadStanding(who.id)).toBe(standing);
  });

  test('учётки нет — строже всего: unconfirmed', async () => {
    expect(await uploadStanding(randomUUID())).toBe('unconfirmed');
  });
});
