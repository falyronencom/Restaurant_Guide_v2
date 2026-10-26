/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Суточный предел распознавания меню на учётку (services/ocrAllowance.js;
 * находка 1 ревью PR #56 по линзе «истощение ресурсов», слово Координатора
 * 17.10.2026 на запуск).
 *
 * Распознавание платное (OpenRouter: на фото меню и на каждую страницу PDF —
 * вызов чтения и вызов разбора) и идёт одной очередью для всех партнёров. В
 * очередь его ставили создание и правка карточки, загрузка в медиа карточки и
 * перезапуск партнёром — без общего счёта; правка ставила файл заново без
 * всякой загрузки. Теперь одна учётка ставит не больше 100 заданий за минские
 * сутки (дом сида — 1000): сверх — задание не ставится, строка в журнал, а
 * сохранение или загрузка проходят. Перезапуск, которому не досталось ни
 * одного задания, — 429. Одобрение модератором не считается.
 *
 * Ожидания — литералы утверждённых чисел (Координатор, 17.10.2026, PR #59) и
 * утверждённого текста лимитера. Через настоящее приложение и настоящий
 * Redis; счётчик дня ставится прямо перед границей; облако подменено.
 * Задание ставится в фоне — сохранение его не ждёт: тест ждёт строку задания,
 * а отказ — по строке журнала.
 */

import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { v2 as cloudinarySdk } from 'cloudinary';
import redisClient, { connectRedis } from '../../config/redis.js';
import logger from '../../utils/logger.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens, createTestEstablishment } from '../utils/auth.js';
import { testEstablishments } from '../fixtures/establishments.js';

// Общий лимитер читает свои числа при загрузке модуля — выше, чем шлёт этот
// файл, чтобы отвечал только суточный предел.
process.env.RATE_LIMIT_AUTHENTICATED = '1000';
process.env.RATE_LIMIT_WINDOW_AUTHENTICATED = '60';
const { default: app } = await import('../../server.js');
const { dailyOcrJobKey } = await import('../../services/ocrAllowance.js');
const adminService = await import('../../services/adminService.js');

const REFUSAL_LOG = 'Daily recognition allowance spent: job not queued';
const LIMITER_TEXT = 'Слишком много запросов. Попробуйте позже.';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** Полдень в Минске (UTC+3). */
const MINSK_NOON = Date.parse('2026-10-17T09:00:00.000Z');
const realNow = Date.now;

/**
 * Сколько ждать исхода постановки, что идёт в фоне, — по настоящим часам.
 * Находка Н43 (25.10.2026): в полном прогоне на загруженной машине файл падал
 * на «исход не наступил за 5 с» и 500 на сохранении карточки, отдельно —
 * зелёный. Подмена часов теста к этому отношения не имеет: пул базы и клиент
 * Redis Date.now не читают, а сдвиг часов теста на годы назад и вперёд роняет
 * только сверку полуночи с литералами. Ожидание — с запасом на медленную базу;
 * что проверяется, не меняется: исход каждого файла, а не время.
 */
const OUTCOME_WAIT_MS = 15000;

// Три ожидания исхода в одном тесте на загруженной машине не укладываются в
// общий срок теста (10 с, jest.config.js).
jest.setTimeout(3 * OUTCOME_WAIT_MS + 10000);

/** С этого места Date.now идёт как обычно, но от момента `originMs`. */
const startClockAt = (originMs) => {
  const realStart = realNow.call(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => originMs + (realNow.call(Date) - realStart));
};

let warn;
let errors;

/**
 * Что сервер записал в журнал ошибок за тест: его собственный текст. Ответ
 * 500 его не несёт (errorHandler отдаёт общую фразу), а без него падение в
 * полном прогоне не объяснить (Н43).
 */
const serverErrors = () => {
  try {
    return JSON.stringify(errors.mock.calls.map(([message, meta]) => ({ message, ...meta })));
  } catch {
    return errors.mock.calls.map(([message]) => message).join(' | ');
  }
};

/** Ответ с ожидаемым кодом — иначе ошибка с телом ответа и журналом сервера. */
const expectStatus = (res, status) => {
  if (res.status !== status) {
    throw new Error(`ожидался ${status}, пришёл ${res.status}: ${JSON.stringify(res.body)}; журнал сервера: ${serverErrors()}`);
  }
  return res;
};

const sweepKeys = async () => {
  const keys = [
    ...await redisClient.keys('ocr:daily:*'),
    ...await redisClient.keys('uploads:daily:*'),
  ];
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required for the daily recognition allowance tests');
    }
  }
  await clearAllData();
});

beforeEach(async () => {
  startClockAt(MINSK_NOON);
  await sweepKeys();
  warn = jest.spyOn(logger, 'warn');
  errors = jest.spyOn(logger, 'error');
  jest.spyOn(cloudinarySdk.uploader, 'upload').mockImplementation(async (_filePath, options) => {
    const id = randomUUID();
    return {
      public_id: `${options.folder}/${id}`,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/${id}.jpg`,
      width: 800,
      height: 600,
      format: 'jpg',
      bytes: 2048,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (redisClient.isReady) {
    await sweepKeys();
  }
  await clearAllData();
});

const newAccount = async ({ role = 'partner', service = false } = {}) => {
  const { user, accessToken } = await createUserAndGetTokens({
    email: `ocr-allowance-${randomUUID()}@test.com`,
    password: 'Partner123!@#',
    name: 'Проверка распознавания',
    role,
  });
  if (service) {
    await query('UPDATE users SET is_service_account = true WHERE id = $1', [user.id]);
  }
  return { id: user.id, token: accessToken };
};

const newPartnerWithCard = async (options) => {
  const partner = await newAccount(options);
  const establishment = await createTestEstablishment(partner.id);
  return { ...partner, establishmentId: establishment.id };
};

/** Ссылка на загрузку партнёра в мастере (своя папка — проверка владения пропускает). */
const menuLink = (account, name) =>
  `https://res.cloudinary.com/test/image/upload/v1/establishments/temp/${account.id}/menu/${name}`;

/** Поставить счётчик дня так, будто сегодня уже поставлено `jobs` заданий. */
const queuedToday = async (account, jobs) => {
  await redisClient.set(dailyOcrJobKey(account.id, new Date(Date.now())), String(jobs), { EX: 3600 });
};

const counter = async (account) =>
  Number(await redisClient.get(dailyOcrJobKey(account.id, new Date(Date.now()))));

const jobsOf = async (establishmentId) => (await query(
  'SELECT media_id FROM ocr_jobs WHERE establishment_id = $1',
  [establishmentId],
)).rows;

const menuMediaOf = async (establishmentId) => (await query(
  "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
  [establishmentId],
)).rows;

const refusalsFor = (account) =>
  warn.mock.calls.filter(([message, meta]) => message === REFUSAL_LOG && meta?.userId === account.id);

/**
 * Дождаться, пока каждый файл меню карточки получит исход: задание или отказ
 * в журнале. Часы теста подменены — срок по настоящим.
 */
const settled = async (account, establishmentId) => {
  const deadline = realNow.call(Date) + OUTCOME_WAIT_MS;
  for (;;) {
    const files = (await menuMediaOf(establishmentId)).length;
    const outcomes = (await jobsOf(establishmentId)).length + refusalsFor(account).length;
    if (files > 0 && outcomes >= files) return;
    if (realNow.call(Date) > deadline) {
      throw new Error(`исход постановки не наступил за ${OUTCOME_WAIT_MS / 1000} с: файлов ${files}, исходов ${outcomes}; журнал сервера: ${serverErrors()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const saveMenu = (account, links) => request(app)
  .put(`/api/v1/partner/establishments/${account.establishmentId}`)
  .set('Authorization', `Bearer ${account.token}`)
  .send({ menu_photos: links });

const retryOcr = (account) => request(app)
  .post(`/api/v1/partner/establishments/${account.establishmentId}/retry-ocr`)
  .set('Authorization', `Bearer ${account.token}`);

const uploadMenuPhoto = (account) => request(app)
  .post(`/api/v1/partner/establishments/${account.establishmentId}/media`)
  .set('Authorization', `Bearer ${account.token}`)
  .field('type', 'menu')
  .attach('file', PNG_BYTES, { filename: 'menu.jpg', contentType: 'image/jpeg' });

/** Файл меню карточки — строкой в базе, без задания. */
const insertMenuFile = async (account, name) => (await query(
  `INSERT INTO establishment_media (establishment_id, type, file_type, url, position)
   VALUES ($1, 'menu', 'image', $2, 0) RETURNING id`,
  [account.establishmentId, menuLink(account, name)],
)).rows[0].id;

/** Сколько перезапусков учётка потратила сегодня (лимитер маршрута, 5 в сутки). */
const restartsToday = async (account) => Number(await redisClient.get(
  `ratelimit:ocr_restart:${account.id}:${Math.floor(Date.now() / 86400000)}`,
));

/**
 * Постановка задания падает по-настоящему: база отвергает строку ocr_jobs
 * (для файла `mediaId` или для всей карточки). Возвращает снятие.
 */
const failQueuing = async ({ establishmentId, mediaId }) => {
  const column = mediaId ? 'media_id' : 'establishment_id';
  const id = mediaId ?? establishmentId;
  const name = `test_fail_queuing_${id.replace(/-/g, '')}`;
  const restore = async () => {
    await query(`DROP TRIGGER IF EXISTS ${name} ON ocr_jobs`);
    await query(`DROP FUNCTION IF EXISTS ${name}()`);
  };
  try {
    await query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'queue refused by the test'; END $$`);
    await query(`CREATE TRIGGER ${name} BEFORE INSERT ON ocr_jobs FOR EACH ROW
      WHEN (NEW.${column} = '${id}'::uuid) EXECUTE FUNCTION ${name}()`);
  } catch (error) {
    await restore();
    throw error;
  }
  return restore;
};

describe('правка карточки (PUT /partner/establishments/:id)', () => {
  test('100-е задание дня ставится; 101-е — нет: правка проходит, файл на месте, строка в журнал', async () => {
    const at99 = await newPartnerWithCard();
    await queuedToday(at99, 99);

    expectStatus(await saveMenu(at99, [menuLink(at99, 'a')]), 200);
    await settled(at99, at99.establishmentId);

    expect(await jobsOf(at99.establishmentId)).toHaveLength(1);
    expect(refusalsFor(at99)).toEqual([]);
    expect(await counter(at99)).toBe(100);

    const at100 = await newPartnerWithCard();
    await queuedToday(at100, 100);

    expectStatus(await saveMenu(at100, [menuLink(at100, 'a')]), 200);
    await settled(at100, at100.establishmentId);

    expect(await menuMediaOf(at100.establishmentId)).toHaveLength(1);
    expect(await jobsOf(at100.establishmentId)).toEqual([]);
    expect(refusalsFor(at100)).toEqual([[REFUSAL_LOG, expect.objectContaining({
      userId: at100.id,
      establishmentId: at100.establishmentId,
      jobs: 101,
      jobsLimit: 100,
    })]]);
    // Резерв сверх предела возвращён.
    expect(await counter(at100)).toBe(100);
  });

  test('одно место и два новых файла — одно задание, второй файл без задания', async () => {
    const partner = await newPartnerWithCard();
    await queuedToday(partner, 99);

    expectStatus(await saveMenu(partner, [menuLink(partner, 'a'), menuLink(partner, 'b')]), 200);
    await settled(partner, partner.establishmentId);

    expect(await menuMediaOf(partner.establishmentId)).toHaveLength(2);
    expect(await jobsOf(partner.establishmentId)).toHaveLength(1);
    expect(refusalsFor(partner)).toHaveLength(1);
    expect(await counter(partner)).toBe(100);
  });
});

describe('один счётчик на все двери учётки', () => {
  test('создание, правка и загрузка в медиа тратят один предел', async () => {
    const partner = await newAccount();
    await queuedToday(partner, 98);

    // Создание карточки с фото меню — 99-е задание.
    const created = expectStatus(await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ ...testEstablishments[0], menu_photos: [menuLink(partner, 'a')] }), 201);
    const card = { ...partner, establishmentId: created.body.data.establishment.id };
    await settled(card, card.establishmentId);

    // Правка добавляет файл — 100-е.
    expectStatus(await saveMenu(card, [menuLink(partner, 'a'), menuLink(partner, 'b')]), 200);
    await settled(card, card.establishmentId);
    expect(await jobsOf(card.establishmentId)).toHaveLength(2);

    // Загрузка фото меню в карточку: файл ложится (свой предел загрузок не
    // тронут), задания нет.
    expectStatus(await uploadMenuPhoto(card), 201);
    await settled(card, card.establishmentId);

    expect(await menuMediaOf(card.establishmentId)).toHaveLength(3);
    expect(await jobsOf(card.establishmentId)).toHaveLength(2);
    expect(refusalsFor(card)).toHaveLength(1);
    expect(await counter(card)).toBe(100);
  });

  // У PDF меню свои места постановки в тех же дверях: создание карточки со
  // списком PDF (establishmentService) и загрузка PDF в медиа (mediaService).
  // Счётчик — после каждой двери: дверь, считающая не в тот ключ, видна сразу.
  test('PDF меню: создание с PDF и загрузка PDF в медиа тратят тот же предел', async () => {
    const partner = await newAccount();
    await queuedToday(partner, 98);
    const pdfLink = (name) =>
      `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${partner.id}/menu_pdf/${name}.pdf`;

    const created = expectStatus(await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ ...testEstablishments[0], menu_pdfs: [{ url: pdfLink('a') }] }), 201);
    const card = { ...partner, establishmentId: created.body.data.establishment.id };
    await settled(card, card.establishmentId);
    expect(await jobsOf(card.establishmentId)).toHaveLength(1);
    expect(await counter(card)).toBe(99);

    cloudinarySdk.uploader.upload.mockImplementation(async (_filePath, options) => {
      const id = randomUUID();
      return {
        public_id: `${options.folder}/${id}`,
        secure_url: `https://res.cloudinary.com/test/image/upload/v1760000000/${options.folder}/${id}.pdf`,
        format: 'pdf',
        bytes: 2048,
        pages: 1,
      };
    });
    const uploadedPdf = await request(app)
      .post(`/api/v1/partner/establishments/${card.establishmentId}/media`)
      .set('Authorization', `Bearer ${card.token}`)
      .field('type', 'menu')
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'menu.pdf', contentType: 'application/pdf' });
    expectStatus(uploadedPdf, 201);
    await settled(card, card.establishmentId);

    expect(await jobsOf(card.establishmentId)).toHaveLength(2);
    expect(refusalsFor(card)).toEqual([]);
    expect(await counter(card)).toBe(100);
  });
});

describe('перезапуск (POST /partner/establishments/:id/retry-ocr)', () => {
  test('предел исчерпан — 429 с текстом лимитера, подробностями и Retry-After до полуночи Минска; заданий нет', async () => {
    const partner = await newPartnerWithCard();
    await insertMenuFile(partner, 'a');
    await queuedToday(partner, 100);
    jest.spyOn(Date, 'now').mockReturnValue(MINSK_NOON);

    const res = await retryOcr(partner);

    expect(res.status).toBe(429);
    expect(res.body.message).toBe(LIMITER_TEXT);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.body.error.details).toEqual({
      jobs_limit: 100,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
    });
    expect(res.headers['retry-after']).toBe('43200');
    expect(await jobsOf(partner.establishmentId)).toEqual([]);
    expect(await counter(partner)).toBe(100);
    // Отказ по пределу — как был: перезапуск засчитан.
    expect(await restartsToday(partner)).toBe(1);
  });

  // Находка Н40 (25.10.2026): у всех файлов постановка упала — сервер отвечал
  // 202 «поставлено 0», приложение — зелёным «Распознавание уже выполняется»,
  // и уходил один из пяти перезапусков дня.
  test('постановка упала у всех файлов — 500 OCR_RESTART_FAILED с текстом для партнёра; перезапуск и места дня возвращены', async () => {
    const partner = await newPartnerWithCard();
    await insertMenuFile(partner, 'a');
    await insertMenuFile(partner, 'b');
    await queuedToday(partner, 10);
    const restore = await failQueuing({ establishmentId: partner.establishmentId });
    let res;
    try {
      res = await retryOcr(partner);
    } finally {
      await restore();
    }

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('OCR_RESTART_FAILED');
    expect(res.body.message).toBe('Не удалось запустить распознавание. Попробуйте позже.');
    expect(await jobsOf(partner.establishmentId)).toEqual([]);
    expect(await counter(partner)).toBe(10);
    expect(await restartsToday(partner)).toBe(0);

    // Следующий перезапуск — первый за день, и ставит оба файла.
    const next = await retryOcr(partner).expect(202);
    expect(next.body.data).toEqual({ enqueuedJobs: 2, totalPdfs: 2 });
    expect(await restartsToday(partner)).toBe(1);
  });

  test('постановка упала у одного файла из двух — 202 «1 из 2», перезапуск засчитан', async () => {
    const partner = await newPartnerWithCard();
    const broken = await insertMenuFile(partner, 'a');
    const fine = await insertMenuFile(partner, 'b');
    const restore = await failQueuing({ mediaId: broken });
    let res;
    try {
      res = await retryOcr(partner);
    } finally {
      await restore();
    }

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ enqueuedJobs: 1, totalPdfs: 2 });
    expect(await jobsOf(partner.establishmentId)).toEqual([{ media_id: fine }]);
    expect(await restartsToday(partner)).toBe(1);
  });

  test('одно место на два файла — одно задание, ответ «1 из 2»', async () => {
    const partner = await newPartnerWithCard();
    await insertMenuFile(partner, 'a');
    await insertMenuFile(partner, 'b');
    await queuedToday(partner, 99);

    const res = await retryOcr(partner).expect(202);

    expect(res.body.data).toEqual({ enqueuedJobs: 1, totalPdfs: 2 });
    expect(await jobsOf(partner.establishmentId)).toHaveLength(1);
    expect(await counter(partner)).toBe(100);
  });

  test('последнее место — файлу без блюд, а не перечитыванию распознанного (ревью по линзе, п. 5)', async () => {
    const partner = await newPartnerWithCard();
    // Распознанный файл — первым по порядку меню.
    const recognised = await insertMenuFile(partner, 'a');
    await query(
      "INSERT INTO ocr_jobs (establishment_id, media_id, status) VALUES ($1, $2, 'done')",
      [partner.establishmentId, recognised],
    );
    const waiting = await insertMenuFile(partner, 'b');
    await queuedToday(partner, 99);

    const res = await retryOcr(partner).expect(202);

    expect(res.body.data).toEqual({ enqueuedJobs: 1, totalPdfs: 2 });
    const pending = await query(
      "SELECT media_id FROM ocr_jobs WHERE establishment_id = $1 AND status = 'pending'",
      [partner.establishmentId],
    );
    expect(pending.rows).toEqual([{ media_id: waiting }]);
  });

  test('файл, чьё задание уже в очереди, места не тратит: на пределе — 202, счётчик прежний', async () => {
    const partner = await newPartnerWithCard();
    const mediaId = await insertMenuFile(partner, 'a');
    await query(
      "INSERT INTO ocr_jobs (establishment_id, media_id, status) VALUES ($1, $2, 'pending')",
      [partner.establishmentId, mediaId],
    );
    await queuedToday(partner, 100);

    const res = await retryOcr(partner).expect(202);

    expect(res.body.data).toEqual({ enqueuedJobs: 1, totalPdfs: 1 });
    expect(await jobsOf(partner.establishmentId)).toHaveLength(1);
    expect(await counter(partner)).toBe(100);
  });
});

describe('дом сида (служебная учётка): свой предел — 1000 заданий', () => {
  test('1000-е задание ставится, 1001-е — нет', async () => {
    const at999 = await newPartnerWithCard({ service: true });
    await queuedToday(at999, 999);
    expectStatus(await saveMenu(at999, [menuLink(at999, 'a')]), 200);
    await settled(at999, at999.establishmentId);
    expect(await jobsOf(at999.establishmentId)).toHaveLength(1);

    const at1000 = await newPartnerWithCard({ service: true });
    await queuedToday(at1000, 1000);
    expectStatus(await saveMenu(at1000, [menuLink(at1000, 'a')]), 200);
    await settled(at1000, at1000.establishmentId);
    expect(await jobsOf(at1000.establishmentId)).toEqual([]);
    expect(refusalsFor(at1000)).toEqual([[REFUSAL_LOG, expect.objectContaining({ jobs: 1001, jobsLimit: 1000 })]]);
  });
});

describe('одобрение модератором — не дверь партнёра', () => {
  test('на исчерпанном пределе владельца одобрение ставит нераспознанное меню; счётчик владельца прежний', async () => {
    const partner = await newPartnerWithCard();
    const mediaId = await insertMenuFile(partner, 'a');
    await query("UPDATE establishments SET status = 'pending' WHERE id = $1", [partner.establishmentId]);
    const admin = await newAccount({ role: 'admin' });
    await queuedToday(partner, 100);

    await adminService.moderateEstablishment(partner.establishmentId, { action: 'approve', adminUserId: admin.id });

    const deadline = realNow.call(Date) + OUTCOME_WAIT_MS;
    while ((await jobsOf(partner.establishmentId)).length === 0 && realNow.call(Date) < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await jobsOf(partner.establishmentId)).toEqual([{ media_id: mediaId }]);
    expect(await counter(partner)).toBe(100);
  });

  // «Нераспознанное» — то, у чего нет готового задания (status 'done'):
  // распознанное раньше одобрение не ставит заново. Модель, что это решает
  // (OcrJobModel.hasCompletedJobForMedia), в юнит-тесте одобрения подменена;
  // здесь — её настоящий запрос. Второй файл без задания — знак, что
  // одобрение дошло до постановки.
  test('одобрение не ставит заново меню, распознанное раньше; нераспознанное — ставит', async () => {
    const partner = await newPartnerWithCard();
    const recognised = await insertMenuFile(partner, 'done-before');
    await query(
      "INSERT INTO ocr_jobs (establishment_id, media_id, status) VALUES ($1, $2, 'done')",
      [partner.establishmentId, recognised],
    );
    const fresh = await insertMenuFile(partner, 'never-read');
    await query("UPDATE establishments SET status = 'pending' WHERE id = $1", [partner.establishmentId]);
    const admin = await newAccount({ role: 'admin' });

    await adminService.moderateEstablishment(partner.establishmentId, { action: 'approve', adminUserId: admin.id });

    const deadline = realNow.call(Date) + OUTCOME_WAIT_MS;
    while ((await jobsOf(partner.establishmentId)).length < 2 && realNow.call(Date) < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const jobs = (await jobsOf(partner.establishmentId)).map((job) => job.media_id);
    expect(jobs.sort()).toEqual([recognised, fresh].sort());
  });
});
