/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Что сервер делает с запросом до маршрутов (server.js, 20.10.2026):
 *  - чужой сайт (CORS) — обычный отказ 403 FORBIDDEN с предупреждением в
 *    журнале; до 20.10 — ошибка без статуса, то есть 500 и стек в журнале;
 *  - общий лимитер стоит раньше разбора тела: запрос, которому он отвечает
 *    429, не разбирается (до 20.10 тело до 10 МБ разбиралось у всех); тело
 *    по-прежнему разбирается до стража запроса, который его читает.
 *
 * Через настоящее приложение с настоящим Redis; малый предел для анонимов,
 * часы — от начала часа (корзина анонимов — час), как в rate-limit-by-account.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import redisClient, { connectRedis } from '../../config/redis.js';
import logger from '../../utils/logger.js';

// Читается один раз, при загрузке middleware/rateLimiter.js, — до приложения.
process.env.RATE_LIMIT_UNAUTHENTICATED = '3';
process.env.RATE_LIMIT_WINDOW_UNAUTHENTICATED = '3600';
const { default: app } = await import('../../server.js');
const { INSUFFICIENT_ROLE_MESSAGE } = await import('../../middleware/auth.js');

const realNow = Date.now;

/** Date.now идёт как обычно, но от 0,5 с после начала текущего часа UTC. */
const startClockAtHourStart = () => {
  const realStart = realNow.call(Date);
  const origin = Math.floor(realStart / 3600000) * 3600000 + 500;
  jest.spyOn(Date, 'now').mockImplementation(() => origin + (realNow.call(Date) - realStart));
};

const sweepRateLimitKeys = async () => {
  const keys = await redisClient.keys('ratelimit:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

/** Вход с телом как есть — строкой, чтобы послать и неразборчивое. */
const login = (rawBody) => request(app)
  .post('/api/v1/auth/login')
  .set('Content-Type', 'application/json')
  .send(rawBody);

const refusal = (res) => ({ status: res.status, code: res.body.error?.code });

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required for rate limit tests');
    }
  }
});

beforeEach(async () => {
  // Тот же журнал, в который пишет errorHandler; записи не выводятся.
  jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  jest.spyOn(logger, 'error').mockImplementation(() => logger);
  startClockAtHourStart();
  await sweepRateLimitKeys();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await sweepRateLimitKeys();
});

describe('CORS: чужой сайт — обычный отказ', () => {
  test('запрос и предварительный запрос с чужого сайта — 403 FORBIDDEN, не 500; в журнале предупреждение без стека', async () => {
    const plain = await request(app).get('/api/v1/health').set('Origin', 'https://foreign.example');
    const preflight = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://foreign.example')
      .set('Access-Control-Request-Method', 'POST');

    for (const res of [plain, preflight]) {
      expect({ status: res.status, message: res.body.message, code: res.body.error?.code })
        .toEqual({ status: 403, message: INSUFFICIENT_ROLE_MESSAGE, code: 'FORBIDDEN' });
      expect(res.headers).not.toHaveProperty('access-control-allow-origin');
    }
    expect(logger.error).not.toHaveBeenCalledWith('Server error occurred', expect.anything());
    const warned = logger.warn.mock.calls.filter(([message]) => message === 'Client error occurred');
    expect(warned).toHaveLength(2);
    for (const [, context] of warned) {
      expect(context).toMatchObject({ statusCode: 403, errorCode: 'FORBIDDEN' });
      expect(context).not.toHaveProperty('stack');
    }
  });

  test('свой сайт (localhost) и запрос без Origin проходят, как прежде', async () => {
    const own = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5000');
    const noOrigin = await request(app).get('/api/v1/health');

    expect([own.status, noOrigin.status]).toEqual([200, 200]);
    expect(own.headers['access-control-allow-origin']).toBe('http://localhost:5000');
  });
});

describe('лимитер раньше разбора тела', () => {
  test('в пределе тело разбирается: неразборчивое — 400 INVALID_JSON, NUL в теле — отказ стража 400', async () => {
    expect(refusal(await login('{"email":'))).toEqual({ status: 400, code: 'INVALID_JSON' });
    expect(refusal(await login('{"email":"a\\u0000@test.com","password":"x"}')))
      .toEqual({ status: 400, code: 'INVALID_FORMAT' });
  });

  test('сверх предела — 429, тело не разбирается: неразборчивое тело не превращается в 400', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).get('/api/v1/health')).status).toBe(200);
    }

    const refused = await login('{"email":');

    expect(refusal(refused)).toEqual({ status: 429, code: 'RATE_LIMIT_EXCEEDED' });
  });
});
