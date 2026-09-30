/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: одна фраза — один вызов модели.
 *
 * С 29.09.2026 карта mobile с фразой в строке поиска берёт выдачу умного
 * поиска (вариант 2Б). На новую фразу список и карта спрашивают её почти
 * одновременно: оба промахиваются мимо кэша разборов и без общей очереди
 * позвали бы модель дважды — стоимостная модель CAT-C-2.2 держится на «один
 * разбор на фразу в час». Разбор в работе поэтому общий для одновременных
 * запросов той же фразы.
 *
 * Модель подменена (global.fetch), база — тоже (searchService): здесь
 * считаются вызовы модели, выдача не важна. Redis в unit-окружении не
 * подключён — кэш разборов молчит, как при промахе.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const emptyPage = async ({ page = 1, limit = 20 } = {}) => ({
  establishments: [],
  pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrevious: page > 1 },
});

jest.unstable_mockModule('../../services/searchService.js', () => ({
  SEARCH_SYNONYM_TERMS: [],
  listActiveEstablishmentNames: jest.fn(async () => []),
  searchWithoutLocation: jest.fn(emptyPage),
  searchByRadius: jest.fn(emptyPage),
}));

const { executeSmartSearch } = await import('../../services/smartSearchService.js');
const { default: logger } = await import('../../utils/logger.js');
const { default: redisClient } = await import('../../config/redis.js');

/** Строки аналитики `smart_search_query`, записанные за тест. */
const queryLogLines = () => logger.info.mock.calls
  .filter(([message]) => message === 'smart_search_query')
  .map(([, line]) => line);

const P1_EMPTY = {
  category: null, cuisine: null, dish: null, dish_variants: [], meal_type: null,
  price_max: null, location: null, sort: null, tags: [], error: null,
};

/** Ответ модели, который приходит не сразу — чтобы запросы успели встретиться. */
function slowAnswer(fields) {
  return () => new Promise((resolve) => {
    setTimeout(() => resolve({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'google/gemini-3.5-flash-lite',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...P1_EMPTY, ...fields }) } }],
      }),
    }), 20);
  });
}

let savedKey;
let originalFetch;

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  originalFetch = global.fetch;
  logger.info.mockClear();
});

test('предпосылка: кэш разборов в unit-окружении молчит (Redis не подключён)', () => {
  // Счёт вызовов модели ниже верен, только пока кэш не отвечает: с живым Redis
  // повторный запрос брал бы разбор оттуда и тест «не залипает» стал бы
  // проверять кэш, а не общий разбор.
  expect(redisClient.isReady).toBe(false);
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  global.fetch = originalFetch;
});

describe('одна фраза — один вызов модели', () => {
  test('два одновременных запроса одной фразы (регистр и пробелы не в счёт) — один вызов, разбор у обоих', async () => {
    global.fetch = jest.fn(slowAnswer({ dish: 'пицца' }));

    const [list, map] = await Promise.all([
      executeSmartSearch('Пицца', { city: 'Минск' }, { limit: 20, page: 1 }),
      executeSmartSearch('  пицца ', { city: 'Минск' }, { limit: 100, page: 1 }),
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(list.fallback).toBe(false);
    expect(map.fallback).toBe(false);
    expect(list.intent.dish).toBe('пицца');
    expect(map.intent.dish).toBe('пицца');
    // Аналитика: вызов модели один — и строка с «не из кэша» одна; второй
    // запрос дождался общего разбора, для счёта стоимости это попадание.
    expect(queryLogLines().map((line) => line.fromCache).sort()).toEqual([false, true]);
  });

  test('общий разбор не залипает: следующий запрос после ответа зовёт модель заново (кэша нет)', async () => {
    global.fetch = jest.fn(slowAnswer({ dish: 'пицца' }));

    await Promise.all([
      executeSmartSearch('пицца', { city: 'Минск' }),
      executeSmartSearch('пицца', { city: 'Минск' }),
    ]);
    await executeSmartSearch('пицца', { city: 'Минск' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('разные фразы не делят разбор', async () => {
    global.fetch = jest.fn(slowAnswer({}));

    await Promise.all([
      executeSmartSearch('пицца', { city: 'Минск' }),
      executeSmartSearch('суши', { city: 'Минск' }),
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('отказ модели тоже общий: один вызов, оба запроса на запасном пути', async () => {
    global.fetch = jest.fn(() => new Promise((resolve) => {
      setTimeout(() => resolve({ ok: false, status: 500, statusText: 'Error', text: async () => 'boom' }), 20);
    }));

    const [a, b] = await Promise.all([
      executeSmartSearch('пицца', { city: 'Минск' }),
      executeSmartSearch('пицца', { city: 'Минск' }),
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(a.fallback).toBe(true);
    expect(b.fallback).toBe(true);
  });
});
