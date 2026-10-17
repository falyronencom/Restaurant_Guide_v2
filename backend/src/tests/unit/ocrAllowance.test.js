/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Суточный предел распознавания — решение модуля по значению счётчика
 * (services/ocrAllowance.js). Redis, база и очередь подменены, часы стоят.
 *
 * Интеграционный тест (daily-ocr-allowance) держит границы через настоящее
 * приложение; здесь — то, что через него не видно или видно лишь с
 * вероятностью: решение по значению ПОСЛЕ увеличения (резерв до проверки),
 * база не спрашивается ниже обычного предела, сбой её ответа — обычный
 * предел, файл с заданием в очереди не тратит места, сбой постановки
 * возвращает резерв, ключ и срок — по минским суткам.
 *
 * Ожидаемые числа — литералы предложения 17.10.2026: обычная учётка 100
 * заданий, дом сида 1000.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../config/redis.js', () => ({
  incrementWithExpiry: jest.fn(),
  decrement: jest.fn(),
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

const { incrementWithExpiry, decrement } = await import('../../config/redis.js');
const { default: pool } = await import('../../config/database.js');
const OcrJobModel = await import('../../models/ocrJobModel.js');
const { default: logger } = await import('../../utils/logger.js');
const {
  reserveDailyOcrJob,
  enqueueWithinDailyAllowance,
  DailyOcrLimitError,
  DAILY_OCR_JOB_LIMITS,
} = await import('../../services/ocrAllowance.js');

const USER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CARD = '0b6e9a52-3f1d-4c8e-9a7b-2d4c6e8f0a1b';
const MEDIA = 'c3d5e7f9-1a2b-4c3d-8e5f-6a7b8c9d0e1f';
/** Полдень в Минске, 17.10.2026. */
const NOON = Date.parse('2026-10-17T09:00:00.000Z');
const KEY = `ocr:daily:${USER}:2026-10-17:jobs`;

const seedHouse = (flag) => {
  pool.query.mockResolvedValue({ rows: [{ is_service_account: flag }] });
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOON);
  incrementWithExpiry.mockReset();
  decrement.mockReset();
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
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({ establishmentId: CARD, mediaId: MEDIA });
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
});
