/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Блок recognition проверки здоровья — services/ocrCeilingHealth.js (нитка
 * «Потолок распознавания: малые правки», находка 3; вариант Б Координатора,
 * 08.11.2026): сегодня и семь минских суток до него — страницы потолка и
 * отказы по видам. Redis подменён, часы — аргументом.
 *
 * Ожидания — литералы: потолок 100 (число Координатора), ключи —
 * ocr:ceiling:<день>:pages и ocr:refusals:<день>:<вид>, дни — минские
 * (Europe/Minsk, UTC+3 круглый год). Счётчик, который Redis не отдал, —
 * null («неизвестно»), не 0.
 */

import { jest } from '@jest/globals';

const redisClient = { isReady: true, mGet: jest.fn() };

jest.unstable_mockModule('../../config/redis.js', () => ({
  default: redisClient,
  withRedisDeadline: (command) => command,
  incrementWithExpiry: jest.fn(),
  decrement: jest.fn(),
  getCounter: jest.fn(),
}));

jest.unstable_mockModule('../../config/database.js', () => {
  const pool = { query: jest.fn() };
  return { default: pool, pool };
});

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { getRecognitionHealth } = await import('../../services/ocrCeilingHealth.js');
const { default: logger } = await import('../../utils/logger.js');

/** 00:30 по Минску 09.11.2026: минские сутки уже новые, по UTC — ещё 08.11. */
const NOW = new Date('2026-11-08T21:30:00.000Z');
const DAYS = ['2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02'];
const KINDS = ['door_ceiling', 'door_share', 'door_jobs', 'reading_ceiling', 'reading_share'];
const keysOf = (date) => [`ocr:ceiling:${date}:pages`, ...KINDS.map((kind) => `ocr:refusals:${date}:${kind}`)];

/** Ответ MGET: по каждому дню — страницы и отказы по видам; не названное — нет ключа (null). */
const answer = (byDay = {}) => DAYS.flatMap((date) => {
  const values = byDay[date] ?? {};
  return [values.pages ?? null, ...KINDS.map((kind) => values[kind] ?? null)];
});

const zeroRefusals = { door_ceiling: 0, door_share: 0, door_jobs: 0, reading_ceiling: 0, reading_share: 0 };

let savedCeiling;

beforeEach(() => {
  redisClient.isReady = true;
  redisClient.mGet.mockReset();
  savedCeiling = process.env.OCR_DAILY_PAGE_CEILING;
  delete process.env.OCR_DAILY_PAGE_CEILING;
});

afterEach(() => {
  if (savedCeiling === undefined) delete process.env.OCR_DAILY_PAGE_CEILING;
  else process.env.OCR_DAILY_PAGE_CEILING = savedCeiling;
});

describe('getRecognitionHealth — неделя потолка распознавания', () => {
  test('одним MGET: сегодня по Минску и семь суток до него, у каждых — страницы и пять видов отказов', async () => {
    redisClient.mGet.mockResolvedValue(answer({
      '2026-11-09': { pages: '37', door_ceiling: '2', reading_share: '1' },
      '2026-11-06': { pages: '100', reading_ceiling: '3' },
    }));

    const block = await getRecognitionHealth({ now: NOW });

    expect(redisClient.mGet).toHaveBeenCalledTimes(1);
    expect(redisClient.mGet.mock.calls[0][0]).toEqual(DAYS.flatMap(keysOf));
    expect(block.ceiling_pages).toBe(100);
    expect(block.ceiling_reached).toBe(false);
    expect(block.redis_ready).toBe(true);
    expect(block.days.map(({ date }) => date)).toEqual(DAYS);
    expect(block.days[0]).toEqual({
      date: '2026-11-09', pages_counted: 37, refusals: { ...zeroRefusals, door_ceiling: 2, reading_share: 1 },
    });
    expect(block.days[3]).toEqual({
      date: '2026-11-06', pages_counted: 100, refusals: { ...zeroRefusals, reading_ceiling: 3 },
    });
    // Нет ключа — ничего не было: 0.
    expect(block.days[7]).toEqual({ date: '2026-11-02', pages_counted: 0, refusals: zeroRefusals });
  });

  test.each([
    ['99 из 100 — двери открыты', '99', false],
    ['100 из 100 — потолок выбран', '100', true],
    ['сверх потолка (повторы считаются без отказа)', '130', true],
  ])('сегодня %s', async (_label, pages, reached) => {
    redisClient.mGet.mockResolvedValue(answer({ '2026-11-09': { pages } }));

    expect((await getRecognitionHealth({ now: NOW })).ceiling_reached).toBe(reached);
  });

  test('переменная OCR_DAILY_PAGE_CEILING: потолок блока — её число, и «выбран» — по нему', async () => {
    process.env.OCR_DAILY_PAGE_CEILING = '40';
    redisClient.mGet.mockResolvedValue(answer({ '2026-11-09': { pages: '40' } }));

    expect(await getRecognitionHealth({ now: NOW })).toMatchObject({ ceiling_pages: 40, ceiling_reached: true });
  });

  test('Redis не готов — неизвестно, а не ноль; Redis не спрашивается', async () => {
    redisClient.isReady = false;

    expect(await getRecognitionHealth({ now: NOW })).toEqual({
      ceiling_pages: 100, ceiling_reached: null, redis_ready: false, days: null,
    });
    expect(redisClient.mGet).not.toHaveBeenCalled();
  });

  test('MGET упал или не успел — неизвестно и строка в журнал; ответ проверки здоровья не падает', async () => {
    redisClient.mGet.mockRejectedValue(new Error('Redis command timed out'));

    expect(await getRecognitionHealth({ now: NOW })).toEqual({
      ceiling_pages: 100, ceiling_reached: null, redis_ready: true, days: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Recognition health: the counters could not be read',
      { error: 'Redis command timed out' },
    );
  });

  test('не число в счётчике — этот счёт неизвестен (null); сегодня неизвестно — и «выбран» неизвестно', async () => {
    redisClient.mGet.mockResolvedValue(answer({ '2026-11-09': { pages: 'abc', door_share: '-1' } }));

    const block = await getRecognitionHealth({ now: NOW });

    expect(block.days[0]).toEqual({
      date: '2026-11-09', pages_counted: null, refusals: { ...zeroRefusals, door_share: null },
    });
    expect(block.ceiling_reached).toBeNull();
  });
});
