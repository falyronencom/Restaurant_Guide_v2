/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Суточные пределы распознавания — решение модуля по значению счётчика
 * (services/ocrAllowance.js). Redis, база и очередь подменены, часы стоят.
 *
 * Интеграционные тесты (daily-ocr-allowance, ocr-page-ceiling) держат границы
 * через настоящее приложение и настоящий Redis; здесь — то, что через них не видно или видно лишь с
 * вероятностью: решение по значению ПОСЛЕ увеличения (резерв до проверки),
 * база не спрашивается ниже обычного предела, сбой её ответа — обычный
 * предел, файл с заданием в очереди не тратит места, сбой постановки
 * возвращает резерв, ключ и срок — по минским суткам.
 *
 * Ожидаемые числа — литералы предложения 17.10.2026: обычная учётка 100
 * заданий, дом сида 1000. Страницы — нитка «Общий потолок распознавания»: потолок
 * всех — число Координатора, учётке 100 и не больше половины потолка,
 * неподтверждённым 40 на всех и 20 на учётку.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../config/redis.js', () => ({
  incrementWithExpiry: jest.fn(),
  decrement: jest.fn(),
  getCounter: jest.fn(),
}));

jest.unstable_mockModule('../../config/database.js', () => {
  const pool = { query: jest.fn() };
  return { default: pool, pool };
});

jest.unstable_mockModule('../../models/ocrJobModel.js', () => ({
  findActiveJob: jest.fn(),
  enqueue: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { incrementWithExpiry, decrement, getCounter } = await import('../../config/redis.js');
const { default: pool } = await import('../../config/database.js');
const OcrJobModel = await import('../../models/ocrJobModel.js');
const { default: logger } = await import('../../utils/logger.js');
const {
  CEILING_HISTORY_DAYS,
  REFUSAL_KINDS,
  RECOGNITION_CEILING,
  accountPageLimit,
  dailyOcrRefusalKey,
  dailyOcrPageCeiling,
  reserveDailyOcrJob,
  enqueueWithinDailyAllowance,
  takePagesForAttempt,
  DailyOcrLimitError,
  DAILY_OCR_ACCOUNT_PAGE_LIMIT,
  DAILY_OCR_JOB_LIMITS,
  DAILY_OCR_PAGE_CEILING,
} = await import('../../services/ocrAllowance.js');
const { UNCONFIRMED_ACCOUNT_DAILY_LIMITS, UNCONFIRMED_DAILY_LIMITS } = await import('../../services/unconfirmedAllowance.js');
const { failureReasonOf, RECOGNITION_CEILING_MESSAGE } = await import('../../services/ocr/failureReason.js');

const USER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CARD = '0b6e9a52-3f1d-4c8e-9a7b-2d4c6e8f0a1b';
const MEDIA = 'c3d5e7f9-1a2b-4c3d-8e5f-6a7b8c9d0e1f';
/** Полдень в Минске, 17.10.2026. */
const NOON = Date.parse('2026-10-17T09:00:00.000Z');
const KEY = `ocr:daily:${USER}:2026-10-17:jobs`;
const OWN_PAGES = `ocr:daily:${USER}:2026-10-17:pages`;
const CEILING_PAGES = 'ocr:ceiling:2026-10-17:pages';
const POOL_PAGES = 'unconfirmed:daily:2026-10-17:ocr_pages';
const SHARE_PAGES = `unconfirmed:daily:2026-10-17:account:${USER}:ocr_pages`;
const SECONDS_TO_MIDNIGHT = 43200;
/** Страницы потолка и отказы дня живут две недели после своих суток (табло проверки здоровья). */
const HISTORY_SECONDS = 14 * 24 * 60 * 60;
const refusalKey = (kind, date = '2026-10-17') => `ocr:refusals:${date}:${kind}`;

const seedHouse = (flag) => {
  pool.query.mockResolvedValue({ rows: [{ is_service_account: flag }] });
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOON);
  incrementWithExpiry.mockReset();
  decrement.mockReset();
  getCounter.mockReset().mockResolvedValue(0);
  pool.query.mockReset();
  OcrJobModel.findActiveJob.mockReset().mockResolvedValue(null);
  OcrJobModel.enqueue.mockReset();
  logger.error.mockClear();
  logger.warn.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('пределы — 100 заданий обычной учётке и 1000 дому сида', () => {
  expect(DAILY_OCR_JOB_LIMITS).toEqual({ regular: 100, service: 1000 });
});

describe('резерв: ключ, шаг и срок — по минским суткам', () => {
  test('шаг 1, срок — до полуночи Минска', async () => {
    incrementWithExpiry.mockResolvedValueOnce(1);

    await reserveDailyOcrJob(USER);

    expect(incrementWithExpiry.mock.calls).toEqual([[KEY, 43200]]);
  });

  test('после полуночи Минска — ключ нового дня и полные сутки впереди', async () => {
    Date.now.mockReturnValue(Date.parse('2026-10-17T21:00:00.000Z'));
    incrementWithExpiry.mockResolvedValueOnce(1);

    await reserveDailyOcrJob(USER);

    expect(incrementWithExpiry.mock.calls).toEqual([[`ocr:daily:${USER}:2026-10-18:jobs`, 86400]]);
  });
});

describe('обычная учётка: решение по значению после увеличения', () => {
  test('100-е задание — разрешено, база не спрашивается, ничего не возвращается', async () => {
    incrementWithExpiry.mockResolvedValueOnce(100);

    expect((await reserveDailyOcrJob(USER)).granted).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
    expect(decrement).not.toHaveBeenCalled();
  });

  test('101-е — отказ; резерв возвращён; база спрошена один раз', async () => {
    incrementWithExpiry.mockResolvedValueOnce(101);
    seedHouse(false);

    const result = await reserveDailyOcrJob(USER);

    expect(result).toEqual({
      granted: false,
      jobs: 101,
      limit: 100,
      retryAfter: 43200,
      resetAt: '2026-10-17T21:00:00.000Z',
    });
    expect(decrement.mock.calls).toEqual([[KEY]]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual([USER]);
  });

  test('поиск признака дома сида упал — обычный предел, отказ, строка в журнал', async () => {
    incrementWithExpiry.mockResolvedValueOnce(101);
    pool.query.mockRejectedValue(new Error('connection terminated'));

    const result = await reserveDailyOcrJob(USER);

    expect(result).toMatchObject({ granted: false, limit: 100 });
    expect(logger.error).toHaveBeenCalledWith(
      'Recognition allowance: service flag lookup failed, the regular limit applies',
      expect.objectContaining({ userId: USER }),
    );
  });
});

describe('дом сида: свой предел', () => {
  test('101-е и 1000-е разрешены, без возврата', async () => {
    seedHouse(true);
    incrementWithExpiry.mockResolvedValueOnce(101).mockResolvedValueOnce(1000);

    expect((await reserveDailyOcrJob(USER)).granted).toBe(true);
    expect((await reserveDailyOcrJob(USER)).granted).toBe(true);
    expect(decrement).not.toHaveBeenCalled();
  });

  test('1001-е — отказ с пределом дома сида', async () => {
    seedHouse(true);
    incrementWithExpiry.mockResolvedValueOnce(1001);

    expect(await reserveDailyOcrJob(USER)).toMatchObject({ granted: false, jobs: 1001, limit: 1000 });
  });
});

describe('enqueueWithinDailyAllowance — постановка в очередь от имени партнёра', () => {
  const request = { userId: USER, establishmentId: CARD, mediaId: MEDIA };

  // Учётка с подтверждённой почтой: общего потолка неподтверждённых нет.
  beforeEach(() => {
    pool.query.mockResolvedValue({ rows: [{ confirmed: true }] });
  });

  test('у файла уже есть задание в очереди — оно и возвращается, места не тратит', async () => {
    const active = { id: 'job-1', status: 'pending' };
    OcrJobModel.findActiveJob.mockResolvedValue(active);

    const result = await enqueueWithinDailyAllowance(request);

    expect(result).toEqual({ queued: true, job: active });
    expect(OcrJobModel.findActiveJob).toHaveBeenCalledWith(MEDIA);
    expect(incrementWithExpiry).not.toHaveBeenCalled();
    expect(OcrJobModel.enqueue).not.toHaveBeenCalled();
  });

  test('место есть — задание ставится', async () => {
    incrementWithExpiry.mockResolvedValueOnce(42);
    const job = { id: 'job-2', status: 'pending' };
    OcrJobModel.enqueue.mockResolvedValue(job);

    const result = await enqueueWithinDailyAllowance(request);

    expect(result).toEqual({ queued: true, job });
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({ establishmentId: CARD, mediaId: MEDIA, countedFor: USER });
    expect(decrement).not.toHaveBeenCalled();
  });

  test('предел исчерпан — задание не ставится, строка в журнал с учёткой, карточкой и файлом', async () => {
    incrementWithExpiry.mockResolvedValueOnce(101);
    seedHouse(false);

    const result = await enqueueWithinDailyAllowance(request);

    expect(result).toEqual({
      queued: false,
      refusal: {
        granted: false, jobs: 101, limit: 100, retryAfter: 43200, resetAt: '2026-10-17T21:00:00.000Z',
      },
    });
    expect(OcrJobModel.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Daily recognition allowance spent: job not queued', {
      userId: USER,
      establishmentId: CARD,
      mediaId: MEDIA,
      jobs: 101,
      jobsLimit: 100,
    });
  });

  test('постановка упала — резерв возвращается, ошибка та же', async () => {
    incrementWithExpiry.mockResolvedValueOnce(7);
    const failure = new Error('insert or update on table "ocr_jobs" violates foreign key constraint');
    OcrJobModel.enqueue.mockRejectedValue(failure);

    await expect(enqueueWithinDailyAllowance(request)).rejects.toBe(failure);
    expect(decrement.mock.calls).toEqual([[KEY]]);
  });
});

describe('enqueueWithinDailyAllowance — учётка без подтверждённой почты (нитка «Расходы посторонних», п. 3)', () => {
  const request = { userId: USER, establishmentId: CARD, mediaId: MEDIA };
  const SHARED = 'unconfirmed:daily:2026-10-17:ocr_jobs';
  const OWN = `unconfirmed:daily:2026-10-17:account:${USER}:ocr_jobs`;

  /** The account's own counter, then the shared one, then the account's share. */
  const countersAfter = (own, shared, share) => {
    incrementWithExpiry.mockResolvedValueOnce(own).mockResolvedValueOnce(shared).mockResolvedValueOnce(share);
  };

  beforeEach(() => {
    pool.query.mockResolvedValue({ rows: [{ confirmed: false }] });
  });

  test('20-е задание на всех и 10-е одной учётки — ставится', async () => {
    countersAfter(10, 20, 10);
    OcrJobModel.enqueue.mockResolvedValue({ id: 'job-3' });

    const result = await enqueueWithinDailyAllowance(request);

    expect(result.queued).toBe(true);
    expect(incrementWithExpiry.mock.calls.slice(1)).toEqual([[SHARED, 43200], [OWN, 43200]]);
    expect(decrement).not.toHaveBeenCalled();
  });

  test('21-е на всех — не ставится; все резервы возвращены; строка в журнал', async () => {
    countersAfter(3, 21, 3);

    const result = await enqueueWithinDailyAllowance(request);

    expect(result).toEqual({
      queued: false,
      refusal: {
        granted: false, jobs: 21, limit: 20, pool: true, retryAfter: 43200, resetAt: '2026-10-17T21:00:00.000Z',
      },
    });
    expect(OcrJobModel.enqueue).not.toHaveBeenCalled();
    expect(decrement.mock.calls).toEqual([[SHARED], [OWN], [KEY]]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Unconfirmed accounts' recognition ceiling spent: job not queued",
      { userId: USER, establishmentId: CARD, mediaId: MEDIA },
    );
  });

  test('11-е одной учётки — не ставится, хотя на всех потолок не выбран', async () => {
    countersAfter(11, 11, 11);

    const result = await enqueueWithinDailyAllowance(request);

    expect(result.queued).toBe(false);
    expect(result.refusal).toEqual(expect.objectContaining({ jobs: 11, limit: 10 }));
  });

  test('постановка упала — возвращаются свой, общий и долевой резервы', async () => {
    countersAfter(3, 4, 3);
    const failure = new Error('insert failed');
    OcrJobModel.enqueue.mockRejectedValue(failure);

    await expect(enqueueWithinDailyAllowance(request)).rejects.toBe(failure);
    expect(decrement.mock.calls).toEqual([[KEY], [SHARED], [OWN]]);
  });

  test('подтверждённость читается одним запросом: почта, телефон или дом сида', async () => {
    countersAfter(3, 4, 3);
    OcrJobModel.enqueue.mockResolvedValue({ id: 'job-4' });

    await enqueueWithinDailyAllowance(request);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/email_verified OR phone_verified/);
    expect(pool.query.mock.calls[0][0]).toMatch(/is_service_account/);
    expect(pool.query.mock.calls[0][1]).toEqual([USER]);
  });
});

describe('числа страниц', () => {
  test('потолок на все обычные учётки — 100 страниц в сутки, одной учётке — не больше 100', () => {
    expect(DAILY_OCR_PAGE_CEILING).toBe(100);
    expect(DAILY_OCR_ACCOUNT_PAGE_LIMIT).toBe(100);
  });

  test('неподтверждённые: 40 страниц на всех и 20 на учётку; задания — прежние 20 и 10', () => {
    expect(UNCONFIRMED_DAILY_LIMITS).toMatchObject({ ocrPages: 40, ocrJobs: 20 });
    expect(UNCONFIRMED_ACCOUNT_DAILY_LIMITS).toMatchObject({ ocrPages: 20, ocrJobs: 10 });
  });

  test.each([
    [100, 50],
    [101, 51],
    [200, 100],
    [1000, 100],
    [1, 1],
  ])('потолок %i — одной учётке не больше половины и не больше ста: %i', (ceiling, limit) => {
    expect(accountPageLimit(ceiling)).toBe(limit);
  });

  test.each([
    ['не задана', {}, 100],
    ['пустая', { OCR_DAILY_PAGE_CEILING: '' }, 100],
    ['целое число', { OCR_DAILY_PAGE_CEILING: '250' }, 250],
    ['с пробелами', { OCR_DAILY_PAGE_CEILING: ' 250 ' }, 250],
    ['ноль', { OCR_DAILY_PAGE_CEILING: '0' }, 100],
    ['отрицательное', { OCR_DAILY_PAGE_CEILING: '-5' }, 100],
    ['дробное', { OCR_DAILY_PAGE_CEILING: '2.5' }, 100],
    ['с приставкой', { OCR_DAILY_PAGE_CEILING: 'OCR_DAILY_PAGE_CEILING=250' }, 100],
    ['сверх точного целого', { OCR_DAILY_PAGE_CEILING: '99999999999999999999' }, 100],
  ])('переменная потолка: %s', (_label, env, expected) => {
    expect(dailyOcrPageCeiling(env)).toBe(expected);
  });
});

describe('дверь смотрит, не потрачены ли страницы дня, и сама их не тратит', () => {
  const request = { userId: USER, establishmentId: CARD, mediaId: MEDIA };

  const counters = (values) => {
    getCounter.mockImplementation(async (key) => values[key] ?? 0);
  };
  const standing = (row) => {
    pool.query.mockResolvedValue({ rows: [row] });
  };

  test('страницы остались (потолок 99 из 100) — задание ставится; счётчики страниц дверь не двигает', async () => {
    standing({ confirmed: true, is_service_account: false });
    counters({ [CEILING_PAGES]: 99 });
    incrementWithExpiry.mockResolvedValueOnce(1);
    OcrJobModel.enqueue.mockResolvedValue({ id: 'job-5' });

    const result = await enqueueWithinDailyAllowance(request);

    expect(result.queued).toBe(true);
    expect(getCounter.mock.calls.map(([key]) => key)).toEqual([OWN_PAGES, CEILING_PAGES]);
    expect(incrementWithExpiry.mock.calls.map(([key]) => key)).toEqual([KEY]);
  });

  test('потолок выбран (100 из 100) — задание не ставится, предел заданий не тронут, строка в журнал', async () => {
    standing({ confirmed: true, is_service_account: false });
    counters({ [CEILING_PAGES]: 100 });

    const result = await enqueueWithinDailyAllowance(request);

    expect(result).toEqual({
      queued: false,
      refusal: {
        granted: false,
        pot: 'ceiling',
        pages: 100,
        limit: 100,
        retryAfter: SECONDS_TO_MIDNIGHT,
        resetAt: '2026-10-17T21:00:00.000Z',
      },
    });
    // Предел заданий не тронут; посчитан только отказ общего потолка у двери —
    // для табло (с 08.11.2026; до того здесь не звали ничего).
    expect(incrementWithExpiry.mock.calls).toEqual([[refusalKey('door_ceiling'), SECONDS_TO_MIDNIGHT + HISTORY_SECONDS]]);
    expect(OcrJobModel.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Recognition pages of the day spent: job not queued', {
      userId: USER,
      establishmentId: CARD,
      mediaId: MEDIA,
      refusedBy: 'ceiling',
      pages: 100,
      pagesLimit: 100,
    });
  });

  test('своя граница: половина потолка, 50 страниц — задание не ставится', async () => {
    standing({ confirmed: true, is_service_account: false });
    counters({ [OWN_PAGES]: 50 });

    expect(await enqueueWithinDailyAllowance(request)).toMatchObject({
      queued: false,
      refusal: { pot: 'account', pages: 50, limit: 50 },
    });
  });

  test.each([
    ['пул неподтверждённых', { [POOL_PAGES]: 40 }, 40, 'unconfirmed_pool'],
    ['доля учётки', { [SHARE_PAGES]: 20 }, 20, 'unconfirmed'],
  ])('неподтверждённая: %s выбран — задание не ставится', async (_label, values, limit, pot) => {
    standing({ confirmed: false, is_service_account: false });
    counters(values);

    expect(await enqueueWithinDailyAllowance(request)).toMatchObject({
      queued: false,
      refusal: { pot, pages: limit, limit },
    });
  });

  test('подтверждённой учётке пул неподтверждённых не мешает и не спрашивается', async () => {
    standing({ confirmed: true, is_service_account: false });
    counters({ [POOL_PAGES]: 40, [SHARE_PAGES]: 20 });
    incrementWithExpiry.mockResolvedValueOnce(1);
    OcrJobModel.enqueue.mockResolvedValue({ id: 'job-6' });

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(true);
    expect(getCounter.mock.calls.map(([key]) => key)).toEqual([OWN_PAGES, CEILING_PAGES]);
  });

  test('дом сида: страниц не считает и не спрашивает, задание учётки не несёт', async () => {
    standing({ confirmed: true, is_service_account: true });
    counters({ [CEILING_PAGES]: 100 });
    incrementWithExpiry.mockResolvedValueOnce(1);
    OcrJobModel.enqueue.mockResolvedValue({ id: 'job-7' });

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(true);
    expect(getCounter).not.toHaveBeenCalled();
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({ establishmentId: CARD, mediaId: MEDIA });
  });

  test('запрос об учётке упал — строгий ответ: страницы и задания как у неподтверждённой, строка в журнал', async () => {
    pool.query.mockRejectedValue(new Error('connection terminated'));
    incrementWithExpiry.mockResolvedValue(1);
    OcrJobModel.enqueue.mockResolvedValue({ id: 'job-8' });

    await enqueueWithinDailyAllowance(request);

    expect(getCounter.mock.calls.map(([key]) => key)).toEqual([OWN_PAGES, POOL_PAGES, SHARE_PAGES, CEILING_PAGES]);
    expect(logger.error).toHaveBeenCalledWith(
      'Recognition allowance: account lookup failed, the limits of an unconfirmed account apply',
      expect.objectContaining({ userId: USER }),
    );
  });
});

describe('takePagesForAttempt — страницы попытки, когда их число уже известно', () => {
  const attemptOf = (pages, attempt = 1) => ({
    userId: USER, pages, attempt, jobId: 'job-9', mediaId: MEDIA,
  });
  const standing = (row) => {
    pool.query.mockResolvedValue({ rows: [row] });
  };
  const countersAfter = (...values) => {
    values.forEach((value) => incrementWithExpiry.mockResolvedValueOnce(value));
  };

  test('подтверждённая: свой предел и потолок всех, шаг — страницы, срок — до полуночи Минска; потолок — ещё неделю', async () => {
    standing({ confirmed: true, is_service_account: false });
    countersAfter(9, 30);

    await takePagesForAttempt(attemptOf(9));

    // Страницы потолка живут неделю после суток — их читает табло проверки
    // здоровья (с 08.11.2026); предел читает только ключ текущих суток.
    expect(incrementWithExpiry.mock.calls).toEqual([
      [OWN_PAGES, SECONDS_TO_MIDNIGHT, 9],
      [CEILING_PAGES, SECONDS_TO_MIDNIGHT + HISTORY_SECONDS, 9],
    ]);
    expect(decrement).not.toHaveBeenCalled();
  });

  test('неподтверждённая: ещё общий пул и её доля', async () => {
    standing({ confirmed: false, is_service_account: false });
    countersAfter(3, 3, 3, 3);

    await takePagesForAttempt(attemptOf(3));

    expect(incrementWithExpiry.mock.calls.map(([key]) => key)).toEqual([OWN_PAGES, POOL_PAGES, SHARE_PAGES, CEILING_PAGES]);
  });

  test('после полуночи Минска — ключи нового дня и полные сутки впереди', async () => {
    Date.now.mockReturnValue(Date.parse('2026-10-17T21:00:00.000Z'));
    standing({ confirmed: true, is_service_account: false });
    countersAfter(1, 1);

    await takePagesForAttempt(attemptOf(1));

    expect(incrementWithExpiry.mock.calls).toEqual([
      [`ocr:daily:${USER}:2026-10-18:pages`, 86400, 1],
      ['ocr:ceiling:2026-10-18:pages', 86400 + HISTORY_SECONDS, 1],
    ]);
  });

  test('повторная попытка — снова все страницы', async () => {
    standing({ confirmed: true, is_service_account: false });
    countersAfter(9, 18);

    await takePagesForAttempt(attemptOf(9, 2));

    expect(incrementWithExpiry.mock.calls.map(([, , step]) => step)).toEqual([9, 9]);
  });

  test('повторная попытка сверх предела не отказывает: считается и идёт дальше', async () => {
    standing({ confirmed: true, is_service_account: false });
    countersAfter(60, 110);

    await expect(takePagesForAttempt(attemptOf(10, 2))).resolves.toBeUndefined();

    expect(decrement).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('100-я страница — можно; 101-я — отказ кодом, взятое возвращено тем же шагом, строка в журнал', async () => {
    standing({ confirmed: true, is_service_account: false });
    countersAfter(10, 100);
    await takePagesForAttempt(attemptOf(10));
    expect(decrement).not.toHaveBeenCalled();

    countersAfter(20, 110);
    const failure = await takePagesForAttempt(attemptOf(10)).catch((error) => error);

    expect(failure.code).toBe(RECOGNITION_CEILING);
    expect(failure.message).toBe(RECOGNITION_CEILING_MESSAGE);
    expect(decrement.mock.calls).toEqual([[OWN_PAGES, 10], [CEILING_PAGES, 10]]);
    expect(logger.warn).toHaveBeenCalledWith('Recognition pages of the day do not fit: file not read', {
      userId: USER,
      jobId: 'job-9',
      mediaId: MEDIA,
      filePages: 10,
      attempt: 1,
      refusedBy: 'ceiling',
      pages: 110,
      pagesLimit: 100,
    });
  });

  test('своя граница: 50 страниц можно, 51-я — отказ, потолка всех не касаясь', async () => {
    standing({ confirmed: true, is_service_account: false });
    countersAfter(50, 60);
    await takePagesForAttempt(attemptOf(1));
    incrementWithExpiry.mockReset();

    countersAfter(51);
    const failure = await takePagesForAttempt(attemptOf(1)).catch((error) => error);

    expect(failure.code).toBe(RECOGNITION_CEILING);
    // Потолка всех не коснулись; отказ доли посчитан для табло (с 08.11.2026).
    expect(incrementWithExpiry.mock.calls.map(([key]) => key)).toEqual([OWN_PAGES, refusalKey('reading_share')]);
    expect(decrement.mock.calls).toEqual([[OWN_PAGES, 1]]);
  });

  test('неподтверждённая: 40-я на всех и 20-я на учётку — можно', async () => {
    standing({ confirmed: false, is_service_account: false });
    countersAfter(20, 40, 20, 90);

    await takePagesForAttempt(attemptOf(1));

    expect(decrement).not.toHaveBeenCalled();
  });

  test.each([
    ['41-я на всех', [5, 41], [[OWN_PAGES, 1], [POOL_PAGES, 1]]],
    ['21-я одной учётки', [21, 30, 21], [[OWN_PAGES, 1], [POOL_PAGES, 1], [SHARE_PAGES, 1]]],
  ])('неподтверждённая: %s — отказ', async (_label, values, returned) => {
    standing({ confirmed: false, is_service_account: false });
    countersAfter(...values);

    const failure = await takePagesForAttempt(attemptOf(1)).catch((error) => error);

    expect(failure.code).toBe(RECOGNITION_CEILING);
    expect(decrement.mock.calls).toEqual(returned);
  });

  test('учётка стала домом сида, пока файл ждал очереди: страницы не считаются', async () => {
    standing({ confirmed: true, is_service_account: true });

    await takePagesForAttempt(attemptOf(9));

    expect(incrementWithExpiry).not.toHaveBeenCalled();
  });

  test('текст отказа партнёру — «временно недоступно», в строке нет чисел для запроса пункта реестра', () => {
    expect(failureReasonOf(RECOGNITION_CEILING_MESSAGE)).toBe('unavailable');
    expect(RECOGNITION_CEILING_MESSAGE).not.toMatch(/\d/);
  });
});

// Нитка «Потолок распознавания: малые правки», находка 3 (вариант Б
// Координатора, 08.11.2026): отказ дня считается там, где случился, — для
// табло проверки здоровья (services/ocrCeilingHealth.js) и пятничного сторожа,
// который краснеет на отказах общего потолка. До правки отказ шёл только в журнал.
describe('отказы дня считаются по видам — для табло и пятничного сторожа', () => {
  const request = { userId: USER, establishmentId: CARD, mediaId: MEDIA };
  const refusalCalls = () => incrementWithExpiry.mock.calls.filter(([key]) => key.startsWith('ocr:refusals:'));
  const counted = (kind) => [[refusalKey(kind), SECONDS_TO_MIDNIGHT + HISTORY_SECONDS]];
  const standing = (row) => {
    pool.query.mockResolvedValue({ rows: [row] });
  };
  const atDoor = (values) => {
    getCounter.mockImplementation(async (key) => values[key] ?? 0);
  };
  const attemptOf = (pages, attempt = 1) => ({
    userId: USER, pages, attempt, jobId: 'job-9', mediaId: MEDIA,
  });

  test('виды и неделя хранения — те, что читают табло и сторож', async () => {
    expect(REFUSAL_KINDS).toEqual(['door_ceiling', 'door_pool', 'door_share', 'reading_ceiling', 'reading_pool', 'reading_share']);
    expect(CEILING_HISTORY_DAYS).toBe(14);
    expect(dailyOcrRefusalKey('door_pool', new Date(NOON))).toBe('ocr:refusals:2026-10-17:door_pool');
    // Сторож идёт без зависимостей и кода сервера не подключает: свой список — тот же.
    const { REFUSAL_FIELDS } = await import('../../../scripts/openrouter-usage/watch.js');
    expect([...REFUSAL_FIELDS]).toEqual([...REFUSAL_KINDS]);
  });

  test('у двери: общий потолок выбран (100 из 100) — door_ceiling, срок — неделя после суток', async () => {
    standing({ confirmed: true, is_service_account: false });
    atDoor({ [CEILING_PAGES]: 100 });

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(false);
    expect(refusalCalls()).toEqual(counted('door_ceiling'));
  });

  test('у двери: 99 из 100 — задание ставится, отказа нет (граница N и N+1 — в тесте выше)', async () => {
    standing({ confirmed: true, is_service_account: false });
    atDoor({ [CEILING_PAGES]: 99 });
    incrementWithExpiry.mockResolvedValueOnce(1);
    OcrJobModel.enqueue.mockResolvedValue({ id: 'job-7' });

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(true);
    expect(refusalCalls()).toEqual([]);
  });

  test.each([
    ['своя доля выбрана (50 из 50)', { confirmed: true }, { [OWN_PAGES]: 50 }],
    ['неподтверждённая: её доля выбрана', { confirmed: false }, { [SHARE_PAGES]: 20 }],
    ['и доля, и потолок выбраны — первой спрошена доля', { confirmed: true }, { [OWN_PAGES]: 50, [CEILING_PAGES]: 100 }],
  ])('у двери: %s — door_share', async (_label, row, values) => {
    standing({ ...row, is_service_account: false });
    atDoor(values);

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(false);
    expect(refusalCalls()).toEqual(counted('door_share'));
  });

  test('у двери: пул неподтверждённых страниц выбран (40 из 40) — door_pool: ждут все новые без почты', async () => {
    standing({ confirmed: false, is_service_account: false });
    atDoor({ [POOL_PAGES]: 40 });

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(false);
    expect(refusalCalls()).toEqual(counted('door_pool'));
  });

  test('у двери: задания дня учётки выбраны (101-е) — door_share', async () => {
    standing({ confirmed: true, is_service_account: false });
    incrementWithExpiry.mockResolvedValueOnce(101);

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(false);
    expect(refusalCalls()).toEqual(counted('door_share'));
  });

  test.each([
    ['21-е задание на всех неподтверждённых — пул: door_pool', [3, 21, 3], 'door_pool'],
    ['11-е задание одной неподтверждённой — её доля: door_share', [11, 11, 11], 'door_share'],
  ])('у двери: %s', async (_label, counters, kind) => {
    standing({ confirmed: false, is_service_account: false });
    counters.forEach((value) => incrementWithExpiry.mockResolvedValueOnce(value));

    expect((await enqueueWithinDailyAllowance(request)).queued).toBe(false);
    expect(refusalCalls()).toEqual(counted(kind));
  });

  test('при чтении: общий потолок — reading_ceiling; доля учётки — reading_share', async () => {
    standing({ confirmed: true, is_service_account: false });
    incrementWithExpiry.mockResolvedValueOnce(10).mockResolvedValueOnce(101);
    await expect(takePagesForAttempt(attemptOf(10))).rejects.toMatchObject({ code: RECOGNITION_CEILING });
    expect(refusalCalls()).toEqual(counted('reading_ceiling'));

    incrementWithExpiry.mockReset();
    incrementWithExpiry.mockResolvedValueOnce(51);
    await expect(takePagesForAttempt(attemptOf(1))).rejects.toMatchObject({ code: RECOGNITION_CEILING });
    expect(refusalCalls()).toEqual(counted('reading_share'));
  });

  test('при чтении, неподтверждённая: пул всех (41-я) — reading_pool; её доля (21-я) — reading_share', async () => {
    standing({ confirmed: false, is_service_account: false });
    incrementWithExpiry.mockResolvedValueOnce(5).mockResolvedValueOnce(41);
    await expect(takePagesForAttempt(attemptOf(5))).rejects.toMatchObject({ code: RECOGNITION_CEILING });
    expect(refusalCalls()).toEqual(counted('reading_pool'));

    incrementWithExpiry.mockReset();
    incrementWithExpiry.mockResolvedValueOnce(21).mockResolvedValueOnce(30).mockResolvedValueOnce(21);
    await expect(takePagesForAttempt(attemptOf(1))).rejects.toMatchObject({ code: RECOGNITION_CEILING });
    expect(refusalCalls()).toEqual(counted('reading_share'));
  });

  test('при чтении: влезло (100 из 100) — отказа нет', async () => {
    standing({ confirmed: true, is_service_account: false });
    incrementWithExpiry.mockResolvedValueOnce(10).mockResolvedValueOnce(100);

    await takePagesForAttempt(attemptOf(10));

    expect(refusalCalls()).toEqual([]);
  });

  test('повтор сверх предела не отказывает — и отказа не считает', async () => {
    standing({ confirmed: true, is_service_account: false });
    incrementWithExpiry.mockResolvedValueOnce(60).mockResolvedValueOnce(130);

    await takePagesForAttempt(attemptOf(10, 2));

    expect(refusalCalls()).toEqual([]);
  });

  test('после минской полуночи — счётчик отказа новых суток', async () => {
    Date.now.mockReturnValue(Date.parse('2026-10-17T21:00:00.000Z'));
    standing({ confirmed: true, is_service_account: false });
    atDoor({ 'ocr:ceiling:2026-10-18:pages': 100 });

    await enqueueWithinDailyAllowance(request);

    expect(refusalCalls()).toEqual([['ocr:refusals:2026-10-18:door_ceiling', 86400 + HISTORY_SECONDS]]);
  });
});

describe('DailyOcrLimitError — отказ перезапуска, которому не досталось ни одного задания', () => {
  test('429, код лимитов, утверждённый текст лимитера, подробности и срок', () => {
    const refusal = new DailyOcrLimitError({
      granted: false, jobs: 101, limit: 100, retryAfter: 43200, resetAt: '2026-10-17T21:00:00.000Z',
    });

    expect(refusal.statusCode).toBe(429);
    expect(refusal.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(refusal.message).toBe('Слишком много запросов. Попробуйте позже.');
    expect(refusal.isOperational).toBe(true);
    expect(refusal.details).toEqual({
      jobs_limit: 100,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
    });
    expect(refusal.retryAfter).toBe(43200);
  });

  test('отказ по страницам называет свой предел', () => {
    const refusal = new DailyOcrLimitError({
      granted: false, pot: 'ceiling', pages: 100, limit: 100, retryAfter: 43200, resetAt: '2026-10-17T21:00:00.000Z',
    });

    expect(refusal.details).toEqual({
      pages_limit: 100,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
    });
  });
});
