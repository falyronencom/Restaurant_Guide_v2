/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: клиент Redis переживает обрыв и не держит запросы (#3 обзора 23.09.2026).
 *
 * Клиент `@redis/client` здесь настоящий, а Redis — поддельный TCP-сервер
 * (startFakeRedis ниже), которым тест управляет: отвечать, молчать или рвать
 * соединение. Так получаются три состояния, которых не добиться от живого
 * redis-test, не задев соседние прогоны:
 *  - «открыт, но не готов» — клиент переподключается (isOpen = true,
 *    isReady = false). Команда без проверки готовности ждёт в очереди клиента,
 *    а глобальный лимитер стоит перед каждым маршрутом API — повис бы каждый
 *    запрос;
 *  - «полуоткрытое соединение» — клиент готов, а ответа нет: Redis, зависший
 *    за живым TCP (гипотеза по исходникам, не наблюдение прода). Спасает
 *    только потолок ожидания на каждое обращение (решение Координатора 30.09);
 *  - «обрыв дольше окна прежних десяти попыток» — прежняя стратегия после
 *    десяти попыток возвращала Error, и клиент закрывался до рестарта процесса.
 *
 * Зависание видно как «не завершилось за N мс» (settleWithin), а не как
 * таймаут теста. Потолок NOT_READY_MS ниже потолка одного обращения (500 мс):
 * зелёный там доказывает, что обращение пропущено без похода в Redis, а не что
 * сработал потолок.
 */

import { jest } from '@jest/globals';
import net from 'node:net';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// /health проверяет и базу; здесь она отвечает всегда — исход решает только Redis.
jest.unstable_mockModule('../../config/database.js', () => {
  const pool = { query: jest.fn() };
  return { default: pool, pool };
});

jest.unstable_mockModule('../../services/searchService.js', () => ({
  SEARCH_SYNONYM_TERMS: [],
  listActiveEstablishmentNames: jest.fn(),
  searchWithoutLocation: jest.fn(),
  searchByRadius: jest.fn(),
}));

/**
 * Обращение, пропущенное без похода в Redis, укладывается сюда с запасом.
 * Верхняя граница — потолок одного обращения (500 мс): таймер потолка раньше
 * срока не срабатывает, так что обращение, дошедшее до Redis, займёт не меньше
 * 500 мс и сюда не уложится. Нижняя — пауза сборки мусора под --runInBand, где
 * весь набор идёт одним процессом (замечание ревью 30.09: при 250 мс запас мал).
 */
const NOT_READY_MS = 450;
/** Одно обращение к молчащему Redis: потолок 500 мс плюс запас. */
const ONE_CALL_MS = 1500;
/** Два обращения подряд (лимитер: счётчик и TTL; умный поиск: чтение и запись кэша). */
const TWO_CALLS_MS = 2500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ждать условия не дольше timeoutMs; true — дождались. */
async function waitFor(predicate, timeoutMs, stepMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await sleep(stepMs);
  }
  return true;
}

/** Чем кончился промис за ms: { settled, value | error, elapsed }. */
async function settleWithin(promise, ms) {
  const started = Date.now();
  let timer;
  const outcome = await Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ settled: true, value }),
      (error) => ({ settled: true, error }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ settled: false }), ms);
    }),
  ]);
  clearTimeout(timer);
  return { ...outcome, elapsed: Date.now() - started };
}

/** Одна команда RESP (массив bulk-строк) из начала буфера или null, если она пришла не целиком. */
function readCommand(buffer) {
  let offset = 0;
  const line = () => {
    const end = buffer.indexOf('\r\n', offset);
    if (end === -1) return null;
    const text = buffer.toString('latin1', offset, end);
    offset = end + 2;
    return text;
  };
  const head = line();
  if (head === null) return null;
  const count = Number(head.slice(1));
  const args = [];
  for (let i = 0; i < count; i += 1) {
    const size = line();
    if (size === null) return null;
    const length = Number(size.slice(1));
    if (buffer.length < offset + length + 2) return null;
    args.push(buffer.toString('utf8', offset, offset + length));
    offset += length + 2;
  }
  return { args, length: offset };
}

/**
 * Поддельный Redis на 127.0.0.1. Протокол — ровно в том объёме, что нужен
 * клиенту для рукопожатия (CLIENT SETINFO, SELECT) и PING. Режимы:
 *  - answer — PING → PONG, остальное → OK: рукопожатие проходит, клиент готов;
 *  - silent — принимает и молчит: до рукопожатия клиент «открыт, но не
 *    готов», после — соединение полуоткрыто;
 *  - drop   — принимает и сразу рвёт: попытка переподключения проваливается
 *    за миллисекунды, а не за секунды отказа порта.
 */
async function startFakeRedis() {
  const sockets = new Set();
  const state = { mode: 'silent', connections: 0, commands: [] };
  const server = net.createServer((socket) => {
    state.connections += 1;
    socket.on('error', () => {});
    if (state.mode === 'drop') {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (let parsed = readCommand(pending); parsed; parsed = readCommand(pending)) {
        pending = pending.subarray(parsed.length);
        const name = parsed.args[0].toUpperCase();
        state.commands.push(name);
        if (state.mode === 'answer') {
          socket.write(name === 'PING' ? '+PONG\r\n' : '+OK\r\n');
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    state,
    setMode(mode) {
      state.mode = mode;
    },
    dropAll() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
    close() {
      this.dropAll();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// Клиент читает адрес при загрузке модуля — сервер и адрес раньше импорта.
const fake = await startFakeRedis();
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = String(fake.port);
process.env.REDIS_PASSWORD = '';

const {
  default: redisClient,
  connectRedis,
  disconnectRedis,
  incrementWithExpiry,
  getCounter,
  getTTL,
  setWithExpiry,
} = await import('../../config/redis.js');
const { rateLimiter } = await import('../../middleware/rateLimiter.js');
const { healthCheck } = await import('../../controllers/healthController.js');
const { executeSmartSearch } = await import('../../services/smartSearchService.js');
const { default: pool } = await import('../../config/database.js');
const searchService = await import('../../services/searchService.js');
const { default: logger } = await import('../../utils/logger.js');

const emptyPage = async ({ page = 1, limit = 20 } = {}) => ({
  establishments: [],
  pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrevious: page > 1 },
});

/** Ответ модели разбора, пришедший не сразу — чтобы два запроса успели встретиться. */
function slowModelAnswer(fields) {
  const intent = {
    category: null, cuisine: null, dish: null, dish_variants: [], meal_type: null,
    price_max: null, location: null, sort: null, tags: [], error: null, ...fields,
  };
  return () => new Promise((resolve) => {
    setTimeout(() => resolve({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'google/gemini-3.5-flash-lite',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(intent) } }],
      }),
    }), 20);
  });
}

/** Глобальный лимитер как в server.js: 'next' — пропустил, 'status N' — ответил сам. */
function passGlobalLimiter() {
  return new Promise((resolve, reject) => {
    const req = { ip: '10.0.0.1', path: '/api/v1/test', method: 'GET' };
    const res = {
      set() {},
      status(code) {
        resolve(`status ${code}`);
        return { json() {} };
      },
    };
    rateLimiter(req, res, () => resolve('next')).catch(reject);
  });
}

/** GET /health через контроллер: { status, redis } — код ответа и вердикт по Redis. */
function callHealth() {
  return new Promise((resolve, reject) => {
    const res = {
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        resolve({ status: this.code, redis: body.data.checks.redis.status });
        return this;
      },
    };
    healthCheck({}, res).catch(reject);
  });
}

/** Два одновременных запроса одной фразы — путь общего ожидания разбора (resolveIntent). */
function twoSimultaneousSmartSearches() {
  return Promise.all([
    executeSmartSearch('Пицца', { city: 'Минск' }, { limit: 20, page: 1 }),
    executeSmartSearch('  пицца ', { city: 'Минск' }, { limit: 100, page: 1 }),
  ]);
}

let savedKey;
let originalFetch;

beforeEach(() => {
  pool.query.mockImplementation(async () => ({ rows: [{ ok: 1 }] }));
  searchService.listActiveEstablishmentNames.mockImplementation(async () => []);
  searchService.searchWithoutLocation.mockImplementation(emptyPage);
  searchService.searchByRadius.mockImplementation(emptyPage);
  savedKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  originalFetch = global.fetch;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  global.fetch = originalFetch;
});

afterAll(async () => {
  if (redisClient.isOpen) await redisClient.disconnect().catch(() => {});
  await fake.close();
});

describe('стратегия переподключения: не сдаваться никогда', () => {
  test('на любой попытке — задержка числом от 0 до 3 с, не ошибка; дальше потолок', () => {
    const strategy = redisClient.options.socket.reconnectStrategy;
    const cause = new Error('connect ECONNREFUSED');
    // 11 — попытка, на которой прежняя стратегия возвращала Error
    for (const attempt of [0, 1, 10, 11, 12, 100, 100000]) {
      const delay = strategy(attempt, cause);
      expect({ attempt, type: delay instanceof Error ? 'Error' : typeof delay })
        .toEqual({ attempt, type: 'number' });
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(3000);
    }
    expect(strategy(100000, cause)).toBe(3000);
  });

  test('журнал попыток: первые десять построчно, дальше каждая двадцатая', () => {
    const strategy = redisClient.options.socket.reconnectStrategy;
    for (let attempt = 0; attempt <= 100; attempt += 1) {
      strategy(attempt, new Error('connect ECONNREFUSED'));
    }
    const logged = logger.warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('Redis reconnecting in'))
      .map((message) => Number(message.match(/attempt (\d+)/)[1]));
    expect(logged).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 40, 60, 80, 100]);
  });
});

describe('клиент открыт, но не готов: обращение пропускается сразу, в Redis не идёт', () => {
  beforeAll(async () => {
    fake.setMode('silent');
    // connect() ждёт готовности, а рукопожатие без ответа её не даст
    redisClient.connect().catch(() => {});
    await waitFor(() => fake.state.connections >= 1, 2000);
  });

  test('предпосылка: клиент открыт и не готов', () => {
    expect(redisClient.isOpen).toBe(true);
    expect(redisClient.isReady).toBe(false);
  });

  test('счётчик лимитера — сразу 1, MULTI не собирается', async () => {
    const multi = jest.spyOn(redisClient, 'multi');
    const outcome = await settleWithin(incrementWithExpiry('ratelimit:test:a', 60), NOT_READY_MS);
    expect(outcome).toMatchObject({ settled: true, value: 1 });
    expect(multi).not.toHaveBeenCalled();
  });

  test('чтение счётчика — сразу 0, GET не уходит', async () => {
    const get = jest.spyOn(redisClient, 'get');
    const outcome = await settleWithin(getCounter('ratelimit:test:a'), NOT_READY_MS);
    expect(outcome).toMatchObject({ settled: true, value: 0 });
    expect(get).not.toHaveBeenCalled();
  });

  test('TTL — сразу отказ, TTL не уходит', async () => {
    const ttl = jest.spyOn(redisClient, 'ttl');
    const outcome = await settleWithin(getTTL('ratelimit:test:a'), NOT_READY_MS);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(Error);
    expect(ttl).not.toHaveBeenCalled();
  });

  test('запись с TTL — сразу отказ: одиночная команда не ждёт в очереди', async () => {
    const outcome = await settleWithin(setWithExpiry('smartsearch:test', '{}', 60), NOT_READY_MS);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(Error);
  });

  test('глобальный лимитер пропускает запрос сразу', async () => {
    const outcome = await settleWithin(passGlobalLimiter(), NOT_READY_MS);
    expect(outcome).toMatchObject({ settled: true, value: 'next' });
  });

  test('/health — сразу 503, PING не уходит', async () => {
    const ping = jest.spyOn(redisClient, 'ping');
    const outcome = await settleWithin(callHealth(), NOT_READY_MS);
    expect(outcome).toMatchObject({ settled: true, value: { status: 503, redis: 'unhealthy' } });
    expect(ping).not.toHaveBeenCalled();
  });

  test('умный поиск: два одновременных запроса одной фразы — оба сразу, модель один раз, кэш не трогается', async () => {
    global.fetch = jest.fn(slowModelAnswer({ dish: 'пицца' }));
    const get = jest.spyOn(redisClient, 'get');
    const setEx = jest.spyOn(redisClient, 'setEx');
    const outcome = await settleWithin(twoSimultaneousSmartSearches(), NOT_READY_MS);
    expect(outcome.settled).toBe(true);
    expect(outcome.value.map((result) => result.intent.dish)).toEqual(['пицца', 'пицца']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(setEx).not.toHaveBeenCalled();
  });

  test('остановка — сразу и без QUIT: QUIT ждал бы в очереди соединения, которого нет', async () => {
    const quit = jest.spyOn(redisClient, 'quit');
    const outcome = await settleWithin(disconnectRedis(), NOT_READY_MS);
    expect(outcome.settled).toBe(true);
    expect(quit).not.toHaveBeenCalled();
    expect(redisClient.isOpen).toBe(false);
  });
});

describe('полуоткрытое соединение: клиент готов, Redis молчит — каждое обращение ограничено потолком', () => {
  beforeAll(async () => {
    fake.dropAll();
    await sleep(50);
    fake.setMode('answer');
    await redisClient.connect();
    fake.setMode('silent');
  });

  test('предпосылка: клиент готов', () => {
    expect(redisClient.isReady).toBe(true);
  });

  test('счётчик лимитера — 1 не позже потолка, хотя команда ушла', async () => {
    const sent = fake.state.commands.length;
    const outcome = await settleWithin(incrementWithExpiry('ratelimit:test:b', 60), ONE_CALL_MS);
    expect(outcome).toMatchObject({ settled: true, value: 1 });
    expect(fake.state.commands.slice(sent)).toContain('INCR');
  });

  test('чтение счётчика — 0 не позже потолка', async () => {
    const outcome = await settleWithin(getCounter('ratelimit:test:b'), ONE_CALL_MS);
    expect(outcome).toMatchObject({ settled: true, value: 0 });
  });

  test('TTL — отказ не позже потолка', async () => {
    const outcome = await settleWithin(getTTL('ratelimit:test:b'), ONE_CALL_MS);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(Error);
  });

  test('запись с TTL — отказ не позже потолка', async () => {
    const outcome = await settleWithin(setWithExpiry('smartsearch:test', '{}', 60), ONE_CALL_MS);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(Error);
  });

  test('глобальный лимитер пропускает запрос не позже двух потолков', async () => {
    const outcome = await settleWithin(passGlobalLimiter(), TWO_CALLS_MS);
    expect(outcome).toMatchObject({ settled: true, value: 'next' });
  });

  test('/health — 503 не позже потолка', async () => {
    const outcome = await settleWithin(callHealth(), ONE_CALL_MS);
    expect(outcome).toMatchObject({ settled: true, value: { status: 503, redis: 'unhealthy' } });
  });

  test('умный поиск: запись кэша в общем ожидании разбора не держит ни один из двух запросов', async () => {
    global.fetch = jest.fn(slowModelAnswer({ dish: 'пицца' }));
    const outcome = await settleWithin(twoSimultaneousSmartSearches(), TWO_CALLS_MS);
    expect(outcome.settled).toBe(true);
    expect(outcome.value.map((result) => result.intent.dish)).toEqual(['пицца', 'пицца']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('остановка — не ждёт ответа на QUIT', async () => {
    const outcome = await settleWithin(disconnectRedis(), ONE_CALL_MS);
    expect(outcome.settled).toBe(true);
    expect(redisClient.isOpen).toBe(false);
  });
});

describe('обрыв дольше окна прежних десяти попыток: клиент не сдаётся и возвращается сам', () => {
  beforeAll(async () => {
    fake.dropAll();
    await sleep(50);
    fake.setMode('answer');
    if (redisClient.isOpen) await redisClient.disconnect().catch(() => {});
    await redisClient.connect();
  });

  test('после 13-й неудачной попытки клиент открыт, а с возвратом Redis — готов и отвечает', async () => {
    expect(redisClient.isReady).toBe(true);
    const before = fake.state.connections;
    fake.setMode('drop');
    fake.dropAll();
    // Прежняя стратегия закрывала клиент после 12-й неудачной попытки
    // (retries > 10 → Error), примерно через 5,5 с после обрыва.
    await waitFor(() => fake.state.connections - before >= 13, 15000);
    expect(fake.state.connections - before).toBeGreaterThanOrEqual(13);
    expect(redisClient.isOpen).toBe(true);
    fake.setMode('answer');
    expect(await waitFor(() => redisClient.isReady, 6000)).toBe(true);
    await expect(redisClient.ping()).resolves.toBe('PONG');

    // Журнал прорежен счётом попыток; готовность обнуляет счёт — иначе первая
    // ошибка следующего обрыва (строка «соединение потеряно») молча пропала бы.
    logger.error.mockClear();
    const readyAgain = new Promise((resolve) => redisClient.once('ready', resolve));
    fake.dropAll();
    expect((await settleWithin(readyAgain, 6000)).settled).toBe(true);
    expect(logger.error.mock.calls.map(([message]) => message)).toContain('Redis client error');
  }, 30000);
});

describe('старт: подключение ограничено по времени', () => {
  beforeAll(async () => {
    if (redisClient.isOpen) await redisClient.disconnect().catch(() => {});
    fake.dropAll();
    await sleep(50);
  });

  test('Redis молчит — false к сроку, попытки остановлены', async () => {
    fake.setMode('silent');
    const outcome = await settleWithin(connectRedis({ timeoutMs: 300 }), 1500);
    expect(outcome).toMatchObject({ settled: true, value: false });
    expect(redisClient.isOpen).toBe(false);
  });

  test('без аргумента срок больше секунды: временный сбой при старте переживается', async () => {
    fake.dropAll();
    await sleep(50);
    fake.setMode('silent');
    const connecting = connectRedis();
    expect((await settleWithin(connecting, 1200)).settled).toBe(false);
    // Redis ответил: рукопожатие на молчащем соединении рвётся, следующая попытка проходит
    fake.setMode('answer');
    fake.dropAll();
    expect(await settleWithin(connecting, 5000)).toMatchObject({ settled: true, value: true });
  });

  test('Redis отвечает — true, а остановка закрывает клиент', async () => {
    if (redisClient.isOpen) await disconnectRedis();
    fake.dropAll();
    await sleep(50);
    fake.setMode('answer');
    const outcome = await settleWithin(connectRedis({ timeoutMs: 2000 }), 3000);
    expect(outcome).toMatchObject({ settled: true, value: true });
    expect(redisClient.isReady).toBe(true);
    await disconnectRedis();
    expect(redisClient.isOpen).toBe(false);
  });
});
