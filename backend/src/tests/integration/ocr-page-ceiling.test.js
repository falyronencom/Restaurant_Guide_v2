/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Страницы распознавания в момент чтения (services/ocrAllowance.js
 * takePagesForAttempt; нитка «Общий потолок распознавания», находки 1 и 2
 * нитки «Расходы посторонних»).
 *
 * Сколько страниц в PDF, известно только когда задание запущено: после
 * скачивания и разбора, до первого вызова модели. Там страницы и берутся, и
 * только там: дверь берёт задание дня, а страницы тратит одно чтение. Не хватает
 * при первой попытке — файл не читается вовсе, модель не зовётся, а партнёр слышит
 * «временно недоступно»; начатый файл доходит до своих повторов, и они считаются.
 * Здесь — настоящие очередь, база и Redis; подменены разбор PDF
 * (отдельный процесс), сам вызов модели и настройка ключа. Двери через настоящие
 * маршруты держит daily-ocr-allowance.
 *
 * Счётчик дня ставится прямо перед границей. Ожидания — литералы: потолок 100
 * (половина на учётку — 50), у неподтверждённых 40 на всех и 20 на учётку, до
 * 20 страниц PDF читается, без числа страниц — 2.
 */

import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';

jest.unstable_mockModule('../../services/ocr/pdfParseRunner.js', () => {
  // lastPageFound — the last page the child found of those read
  // (pdfParseChild); not set — the parse did not say, the declared count stands.
  const state = { numpages: 1, text: '', fails: false, lastPageFound: undefined };
  const abortedError = (message = 'PDF parse cut short by shutdown') => Object.assign(
    new Error(message),
    { code: 'PDF_PARSE_ABORTED', reason: 'aborted' },
  );
  return {
    PDF_PARSE_LIMIT: 'PDF_PARSE_LIMIT',
    PDF_PARSE_ABORTED: 'PDF_PARSE_ABORTED',
    abortedError,
    __state: state,
    parsePdfIsolated: async () => {
      if (state.fails) throw new Error('bad XRef entry');
      return {
        numpages: state.numpages,
        text: state.text,
        textLength: state.text.length,
        lastPageFound: state.lastPageFound,
      };
    },
  };
});

jest.unstable_mockModule('../../config/openrouter.js', () => {
  const config = { apiKey: 'test-key', baseUrl: 'https://test.openrouter.ai/api/v1', model: 'test-model' };
  return {
    getConfig: () => config,
    getOcrConfig: () => config,
    isAvailable: () => true,
  };
});

const { __state: parser } = await import('../../services/ocr/pdfParseRunner.js');
const { default: redisClient, connectRedis } = await import('../../config/redis.js');
const { clearAllData, query } = await import('../utils/database.js');
const { createUserAndGetTokens, createTestEstablishment } = await import('../utils/auth.js');
const ocrJobModel = await import('../../models/ocrJobModel.js');
const ocrService = await import('../../services/ocr/ocrService.js');
const adminService = await import('../../services/adminService.js');
const partnerMenuItemService = await import('../../services/partnerMenuItemService.js');
const {
  dailyOcrCeilingKey,
  dailyOcrJobKey,
  dailyOcrPagesKey,
  enqueueWithinDailyAllowance,
} = await import('../../services/ocrAllowance.js');
const { unconfirmedAccountKeys, unconfirmedKeys } = await import('../../services/unconfirmedAllowance.js');

const REFUSAL_MESSAGE = 'Pages of the file do not fit the day of recognition';

const today = () => new Date(Date.now());
const ceilingKey = () => dailyOcrCeilingKey(today());
const ownPages = (card) => dailyOcrPagesKey(card.userId, today());
const ownJobs = (card) => dailyOcrJobKey(card.userId, today());
const count = async (key) => Number(await redisClient.get(key));
const setCount = (key, value) => redisClient.set(key, String(value), { EX: 3600 });

const sweepKeys = async () => {
  const keys = [
    ...await redisClient.keys('ocr:daily:*'),
    ...await redisClient.keys('ocr:ceiling:*'),
    ...await redisClient.keys('unconfirmed:daily:*'),
  ];
  if (keys.length > 0) await redisClient.del(keys);
};

let originalFetch;
let calls;
let visionFails;

/** Модель и скачивание: чтение страницы — текст, разбор — одна позиция. */
const modelFetch = jest.fn();
const installFetch = () => {
  calls = { vision: 0, structurer: 0 };
  visionFails = false;
  modelFetch.mockImplementation(async (url, init) => {
    if (!url.includes('/chat/completions')) {
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
    }
    const kind = Array.isArray(JSON.parse(init.body).messages[1].content) ? 'vision' : 'structurer';
    calls[kind] += 1;
    if (kind === 'vision' && visionFails) {
      return { ok: false, status: 500, text: async () => 'upstream failure' };
    }
    const content = kind === 'vision'
      ? 'Борщ — 15 руб.'
      : JSON.stringify({ items: [{ item_name: `Борщ ${calls.structurer}`, price_byn: 15, category_raw: 'Супы', confidence: 0.9 }] });
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
    };
  });
  global.fetch = modelFetch;
};

const newCard = async ({ confirmed = true, service = false } = {}) => {
  const { user } = await createUserAndGetTokens({
    email: `ocr-pages-${randomUUID()}@test.com`,
    password: 'Partner123!@#',
    name: 'Проверка страниц',
    role: 'partner',
  });
  if (confirmed) await query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]);
  if (service) await query('UPDATE users SET is_service_account = true WHERE id = $1', [user.id]);
  const establishment = await createTestEstablishment(user.id);
  return { userId: user.id, establishmentId: establishment.id };
};

const insertMenuFile = async (card, fileType = 'pdf') => {
  const mediaId = randomUUID();
  const url = fileType === 'pdf'
    ? `https://res.cloudinary.com/test/image/upload/v1/establishments/${card.establishmentId}/menu_pdf/${mediaId}.pdf`
    : `https://res.cloudinary.com/test/image/upload/v1/establishments/${card.establishmentId}/menu/${mediaId}.jpg`;
  await query(
    `INSERT INTO establishment_media (
       id, establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary
     ) VALUES ($1, $2, 'menu', $3, $4, $4, $4, 0, false)`,
    [mediaId, card.establishmentId, fileType, url],
  );
  return mediaId;
};

/** Партнёр просит распознать файл: настоящая дверь. */
const askAtDoor = (card, mediaId) => enqueueWithinDailyAllowance({
  userId: card.userId,
  establishmentId: card.establishmentId,
  mediaId,
});

/** Очередной запуск: настоящие выбор из очереди и обработка; строка задания после. */
const runNext = async () => {
  const picked = await ocrJobModel.pickNextPending();
  const result = await ocrService.processJob(picked.id);
  return { result, job: await ocrJobModel.getJobStatus(picked.id) };
};

const failureNotices = async (card) => (await query(
  "SELECT message FROM notifications WHERE user_id = $1 AND title = 'Меню не распознано'",
  [card.userId],
)).rows;

const jobRows = async (card) => (await query(
  'SELECT id FROM ocr_jobs WHERE establishment_id = $1',
  [card.establishmentId],
)).rows;

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) throw new Error('Redis connection is required: the allowances count there');
  }
  originalFetch = global.fetch;
});

beforeEach(async () => {
  await clearAllData();
  await sweepKeys();
  Object.assign(parser, { numpages: 1, text: '', fails: false, lastPageFound: undefined });
  installFetch();
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

afterAll(async () => {
  await sweepKeys();
  await clearAllData();
});

describe('PDF стоит столько, сколько страниц прочитано', () => {
  test('9 страниц: дверь берёт задание, страницы — запуск; прочитаны все; метка сменилась итогом', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 9;

    await askAtDoor(card, mediaId);
    expect(await count(ownJobs(card))).toBe(1);
    expect(await count(ownPages(card))).toBe(0);
    expect(await count(ceilingKey())).toBe(0);

    const { result, job } = await runNext();

    expect(result.success).toBe(true);
    expect(calls.vision).toBe(9);
    expect(await count(ceilingKey())).toBe(9);
    expect(await count(ownPages(card))).toBe(9);
    expect(await count(ownJobs(card))).toBe(1);
    expect(job.result_summary.pages_counted_for).toBeUndefined();
    expect(job.result_summary.pages_count).toBe(9);
  });

  test('длиннее 20 страниц — читается 20, столько и стоит', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 25;

    await askAtDoor(card, mediaId);
    await runNext();

    expect(calls.vision).toBe(20);
    expect(await count(ceilingKey())).toBe(20);
  });

  // Нитка «Потолок распознавания: малые правки», находка 10: число страниц —
  // слово самого файла. Файл заявляет 20 страниц, а в нём одна: страницы
  // дальше неё облако не нарисует, а потолок их считал.
  test.each([
    // [заявлено, последняя найденная, прочитано и стоит]
    ['заявил 20, в нём одна — читается одна, столько и стоит', 20, 1, 1],
    ['заявил 2, в нём одна — на страницу меньше тоже видно', 2, 1, 1],
    ['заявил 2, в нём обе — как прежде', 2, 2, 2],
  ])('%s', async (_label, declared, lastPageFound, pages) => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    Object.assign(parser, { numpages: declared, lastPageFound });

    await askAtDoor(card, mediaId);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(pages);
    expect(await count(ceilingKey())).toBe(pages);
    expect(await count(ownPages(card))).toBe(pages);
    expect(job.result_summary.pages_count).toBe(pages);
  });

  test('заявил 20, в нём одна: сбой чтения и повтор — на счётчиках 2, а не 40', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    Object.assign(parser, { numpages: 20, lastPageFound: 1 });

    await askAtDoor(card, mediaId);
    visionFails = true;
    expect((await runNext()).job.status).toBe('pending');
    visionFails = false;
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(await count(ceilingKey())).toBe(2);
  });

  test('разбор не назвал число страниц — читается 2, столько и стоит', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.fails = true;

    await askAtDoor(card, mediaId);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(2);
    expect(await count(ceilingKey())).toBe(2);
  });

  test('фото — одна страница', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card, 'image');

    await askAtDoor(card, mediaId);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(1);
    expect(await count(ceilingKey())).toBe(1);
  });
});

describe('граница потолка в момент чтения: страницы известны, модель ещё не звали', () => {
  test('осталось ровно на этот PDF — читается, потолок дошёл до 100', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 10;
    await setCount(ceilingKey(), 90);

    await askAtDoor(card, mediaId);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(10);
    expect(await count(ceilingKey())).toBe(100);
  });

  test('на страницу меньше — ни одной: модель не звали, задание закрыто с первого раза, страницы не взяты, партнёру сказано', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 10;
    await setCount(ceilingKey(), 91);

    await askAtDoor(card, mediaId);
    const { result, job } = await runNext();

    expect(result.success).toBe(false);
    expect(calls).toEqual({ vision: 0, structurer: 0 });
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(job.error_message).toBe(REFUSAL_MESSAGE);
    expect(await count(ceilingKey())).toBe(91);
    expect(await count(ownPages(card))).toBe(0);

    const { recognition } = await partnerMenuItemService.listMenuItems(card.userId, card.establishmentId);
    expect(recognition).toMatchObject({
      status: 'failed',
      cause: 'service_failure',
      reason: 'Распознавание меню временно недоступно — попробуйте позже.',
    });
    expect(await failureNotices(card)).toEqual([
      { message: 'Распознавание меню «Test Restaurant» временно недоступно. Попробуйте позже.' },
    ]);
  });

  test('фото на выбранном потолке, встало в очередь раньше: не читается, партнёру сказано', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card, 'image');

    await askAtDoor(card, mediaId);
    await setCount(ceilingKey(), 100);
    const { job } = await runNext();

    expect(job.status).toBe('failed');
    expect(job.error_message).toBe(REFUSAL_MESSAGE);
    expect(calls.vision).toBe(0);
    expect(await count(ceilingKey())).toBe(100);
  });

  test('в новых минских сутках та же просьба читает файл целиком', async () => {
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValue(Date.parse('2026-10-17T20:00:00.000Z'));
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 10;
    await setCount(ceilingKey(), 95);
    await askAtDoor(card, mediaId);
    await runNext();
    expect(calls.vision).toBe(0);

    // Минская полночь — 21:00 UTC.
    dateNow.mockReturnValue(Date.parse('2026-10-17T21:01:00.000Z'));

    await askAtDoor(card, mediaId);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(10);
    expect(await count(ceilingKey())).toBe(10);
  });

  test('задание встало в очередь до минской полночи, читается после: страницы — в новых сутках', async () => {
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValue(Date.parse('2026-10-17T20:59:00.000Z'));
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 5;
    const oldDay = ceilingKey();
    await askAtDoor(card, mediaId);

    dateNow.mockReturnValue(Date.parse('2026-10-17T21:01:00.000Z'));
    const newDay = ceilingKey();
    expect(newDay).not.toBe(oldDay);

    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(await count(oldDay)).toBe(0);
    expect(await count(newDay)).toBe(5);
  });

  test('своя граница: половина потолка, 50 страниц; 51-я не читается, хотя потолок не выбран', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 10;
    await setCount(ownPages(card), 41);

    await askAtDoor(card, mediaId);
    const refused = await runNext();

    expect(refused.job.error_message).toBe(REFUSAL_MESSAGE);
    expect(calls.vision).toBe(0);
    expect(await count(ownPages(card))).toBe(41);
    expect(await count(ceilingKey())).toBe(0);

    parser.numpages = 9;
    await askAtDoor(card, mediaId);
    const read = await runNext();

    expect(read.job.status).toBe('done');
    expect(await count(ownPages(card))).toBe(50);
  });
});

describe('отказ и снятие файла: страницы тратит только чтение, задание дня тратится всегда', () => {
  test('файл, не поместившийся в остаток, стоит задание дня: повторять его без конца нельзя', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 10;
    await setCount(ceilingKey(), 95);
    await setCount(ownJobs(card), 98);

    await askAtDoor(card, mediaId);
    await runNext();
    expect(await count(ownJobs(card))).toBe(99);

    await askAtDoor(card, mediaId);
    await runNext();
    expect(await count(ownJobs(card))).toBe(100);

    const refused = await askAtDoor(card, mediaId);

    expect(refused.queued).toBe(false);
    expect(refused.refusal).toMatchObject({ jobs: 101, limit: 100 });
    expect(await jobRows(card)).toHaveLength(2);
    expect(calls.vision).toBe(0);
    expect(await count(ceilingKey())).toBe(95);
  });

  test('неподтверждённая: задания отказанных файлов держатся её прежней долей 10', async () => {
    const card = await newCard({ confirmed: false });
    const mediaId = await insertMenuFile(card);
    parser.numpages = 20;
    await setCount(unconfirmedAccountKeys(card.userId, today()).ocrPages, 5);

    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await askAtDoor(card, mediaId)).queued).toBe(true);
      // eslint-disable-next-line no-await-in-loop
      await runNext();
    }
    const eleventh = await askAtDoor(card, mediaId);

    expect(eleventh.queued).toBe(false);
    expect(eleventh.refusal).toMatchObject({ limit: 10 });
    expect(calls.vision).toBe(0);
  });

  test('файл сняли с карточки, пока задание ждало: страницы не потрачены, потолок не занят; задание дня потрачено', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);

    await askAtDoor(card, mediaId);
    await query('DELETE FROM establishment_media WHERE id = $1', [mediaId]);

    expect(await jobRows(card)).toEqual([]);
    expect(await count(ceilingKey())).toBe(0);
    expect(await count(ownPages(card))).toBe(0);
    expect(await count(ownJobs(card))).toBe(1);
  });
});

describe('повторная попытка оплачена заново и считается заново', () => {
  test('PDF в 3 страницы: сбой чтения и повтор — на счётчиках 6', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 3;

    await askAtDoor(card, mediaId);
    visionFails = true;
    const first = await runNext();
    expect(first.job.status).toBe('pending');
    expect(await count(ceilingKey())).toBe(3);

    visionFails = false;
    const second = await runNext();

    expect(second.job.status).toBe('done');
    expect(await count(ceilingKey())).toBe(6);
  });

  test('фото: сбой и повтор — на счётчиках 2', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card, 'image');

    await askAtDoor(card, mediaId);
    visionFails = true;
    await runNext();
    visionFails = false;
    const second = await runNext();

    expect(second.job.status).toBe('done');
    expect(await count(ceilingKey())).toBe(2);
  });

  test('начатый файл не останавливается: повтор на выбранном потолке читается и считается; новых файлов дверь не пускает', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 3;

    await askAtDoor(card, mediaId);
    visionFails = true;
    const first = await runNext();
    expect(first.job.status).toBe('pending');
    await setCount(ceilingKey(), 99);
    visionFails = false;

    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(job.attempts).toBe(2);
    expect(await count(ceilingKey())).toBe(102);

    const other = await newCard();
    const refused = await askAtDoor(other, await insertMenuFile(other));
    expect(refused.queued).toBe(false);
    expect(refused.refusal).toMatchObject({ pot: 'ceiling', pages: 102, limit: 100 });
  });

  test('большой PDF при малой доле не теряет повторы: у неподтверждённой 20 страниц, три попытки, текстовый слой на последней', async () => {
    const card = await newCard({ confirmed: false });
    const mediaId = await insertMenuFile(card);
    parser.numpages = 20;
    parser.text = 'Борщ 15 руб. Салат 12 руб. Пицца 18 руб. Кофе 4 руб. Вода 3 руб. '.repeat(30);

    await askAtDoor(card, mediaId);
    visionFails = true;
    expect((await runNext()).job.status).toBe('pending');
    expect((await runNext()).job.status).toBe('pending');
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(job.attempts).toBe(3);
    expect(job.result_summary.strategy).toBe('pdf_text_layer');
    expect(await count(unconfirmedAccountKeys(card.userId, today()).ocrPages)).toBe(60);
  });

  test('отказ на первой попытке не уводит в текстовый слой: разборщика не звали', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 3;
    parser.text = 'Борщ 15 руб. Салат 12 руб. Пицца 18 руб. Кофе 4 руб. Вода 3 руб. '.repeat(10);

    // Единственная попытка задания — она же последняя, с запасным текстовым слоем.
    const { job: queued } = await askAtDoor(card, mediaId);
    await query('UPDATE ocr_jobs SET max_attempts = 1 WHERE id = $1', [queued.id]);
    await setCount(ceilingKey(), 99);

    const { job } = await runNext();

    expect(job.status).toBe('failed');
    expect(job.error_message).toBe(REFUSAL_MESSAGE);
    expect(calls).toEqual({ vision: 0, structurer: 0 });
  });
});

describe('неподтверждённые учётки: PDF тоже в страницах', () => {
  const sharePages = (card) => unconfirmedAccountKeys(card.userId, today()).ocrPages;
  const poolPages = () => unconfirmedKeys(today()).ocrPages;

  test('PDF в 20 страниц новой учётке читается: как и до правки', async () => {
    const card = await newCard({ confirmed: false });
    const mediaId = await insertMenuFile(card);
    parser.numpages = 20;

    await askAtDoor(card, mediaId);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(20);
    expect(await count(sharePages(card))).toBe(20);
    expect(await count(poolPages())).toBe(20);
    expect(await count(ceilingKey())).toBe(20);
  });

  test('доля учётки: после 5 страниц PDF в 16 не читается, в 15 — читается', async () => {
    const card = await newCard({ confirmed: false });
    const mediaId = await insertMenuFile(card);
    await setCount(sharePages(card), 5);
    parser.numpages = 16;

    await askAtDoor(card, mediaId);
    const refused = await runNext();
    expect(refused.job.error_message).toBe(REFUSAL_MESSAGE);
    expect(await count(sharePages(card))).toBe(5);
    expect(await count(ceilingKey())).toBe(0);

    parser.numpages = 15;
    await askAtDoor(card, mediaId);
    const read = await runNext();
    expect(read.job.status).toBe('done');
    expect(await count(sharePages(card))).toBe(20);
  });

  test('общий пул: после 30 страниц других учёток PDF в 11 не читается, в 10 — читается', async () => {
    const card = await newCard({ confirmed: false });
    const mediaId = await insertMenuFile(card);
    await setCount(poolPages(), 30);
    parser.numpages = 11;

    await askAtDoor(card, mediaId);
    const refused = await runNext();
    expect(refused.job.error_message).toBe(REFUSAL_MESSAGE);
    expect(await count(poolPages())).toBe(30);

    parser.numpages = 10;
    await askAtDoor(card, mediaId);
    const read = await runNext();
    expect(read.job.status).toBe('done');
    expect(await count(poolPages())).toBe(40);
  });

  test('подтвердил почту, пока файл ждал очереди: пул и доля неподтверждённых страниц не считают', async () => {
    const card = await newCard({ confirmed: false });
    const mediaId = await insertMenuFile(card);
    await setCount(sharePages(card), 15);
    parser.numpages = 12;

    await askAtDoor(card, mediaId);
    await query('UPDATE users SET email_verified = true WHERE id = $1', [card.userId]);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(12);
    expect(await count(sharePages(card))).toBe(15);
    expect(await count(ceilingKey())).toBe(12);
  });
});

describe('что потолок не считает и не останавливает', () => {
  const adminId = async () => (await createUserAndGetTokens({
    email: `ocr-pages-admin-${randomUUID()}@test.com`,
    password: 'Partner123!@#',
    name: 'Модератор',
    role: 'admin',
  })).user.id;

  test('одобрение модератором на выбранном потолке: PDF читается целиком, счётчики не тронуты', async () => {
    const card = await newCard();
    await insertMenuFile(card);
    await query("UPDATE establishments SET status = 'pending' WHERE id = $1", [card.establishmentId]);
    parser.numpages = 9;
    await setCount(ceilingKey(), 100);

    await adminService.moderateEstablishment(card.establishmentId, { action: 'approve', adminUserId: await adminId() });
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(9);
    expect(await count(ceilingKey())).toBe(100);
    expect(await count(ownPages(card))).toBe(0);
  });

  test('скрипт оператора пишет строку задания сам: PDF читается целиком, счётчики не тронуты', async () => {
    const card = await newCard();
    const mediaId = await insertMenuFile(card);
    parser.numpages = 9;
    await setCount(ceilingKey(), 100);
    await query(
      "INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts) VALUES ($1, $2, 'pending', 0)",
      [card.establishmentId, mediaId],
    );

    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(9);
    expect(await count(ceilingKey())).toBe(100);
  });

  test('дом сида: дверь считает задание, страницы не считаются, потолка для него нет', async () => {
    const card = await newCard({ service: true });
    const mediaId = await insertMenuFile(card);
    parser.numpages = 9;
    await setCount(ceilingKey(), 100);

    await askAtDoor(card, mediaId);
    const { job } = await runNext();

    expect(job.status).toBe('done');
    expect(calls.vision).toBe(9);
    expect(await count(ceilingKey())).toBe(100);
    expect(await count(ownPages(card))).toBe(0);
    expect(await count(ownJobs(card))).toBe(1);
  });
});
