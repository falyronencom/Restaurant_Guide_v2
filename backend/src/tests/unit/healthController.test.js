/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * GET /api/v1/health отвечает без входа — значит, говорит только «ok / сбой»
 * по каждой части (база, Redis), статус ответа 200 / 503 и uptime, по которому
 * сверяют выкатку. Текст ошибки (адрес, порт, пользователь базы) — только в
 * журнал; памяти процесса в ответе нет. До 20.10.2026 ответ нёс и то и другое.
 */

import { jest } from '@jest/globals';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../utils/logger.js', () => ({ default: logger }));

const pool = { query: jest.fn() };
jest.unstable_mockModule('../../config/database.js', () => ({ default: pool }));

const redisClient = { isReady: true, ping: jest.fn() };
jest.unstable_mockModule('../../config/redis.js', () => ({
  default: redisClient,
  withRedisDeadline: (promise) => promise,
}));

const { healthCheck } = await import('../../controllers/healthController.js');

// Внутренний текст, какой отдают драйверы: адрес, порт, имя пользователя.
const DB_FAILURE = 'connect ECONNREFUSED 10.20.30.40:5432 (user "railway_owner")';
const REDIS_FAILURE = 'connect ECONNREFUSED 10.20.30.41:6379';

const callHealth = async () => {
  const res = {
    status: jest.fn(function status(code) { this.code = code; return this; }),
    json: jest.fn(function json(body) { this.body = body; return this; }),
  };
  await healthCheck({}, res);
  return { status: res.code, body: res.body };
};

/** Ключи ответа на всех уровнях — форма без значений. */
const shapeOf = (value) => (
  value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]))
    : typeof value
);

beforeEach(() => {
  jest.clearAllMocks();
  redisClient.isReady = true;
  pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  redisClient.ping.mockResolvedValue('PONG');
});

describe('GET /health без входа: статус, uptime и «ok / сбой» по частям', () => {
  test('всё здорово — 200; в ответе нет памяти процесса, форма прежняя', async () => {
    const { status, body } = await callHealth();

    expect(status).toBe(200);
    expect(shapeOf(body)).toEqual({
      data: {
        checks: {
          database: { responseTime: 'number', status: 'string' },
          redis: { responseTime: 'number', status: 'string' },
        },
        responseTime: 'number',
        status: 'string',
        timestamp: 'string',
        uptime: 'number',
      },
      success: 'boolean',
      timestamp: 'string',
    });
    expect(body.data.checks.database.status).toBe('healthy');
    expect(body.data.checks.redis.status).toBe('healthy');
  });

  test('база не отвечает — 503, «сбой» без текста ошибки; текст — в журнале', async () => {
    pool.query.mockRejectedValue(new Error(DB_FAILURE));

    const { status, body } = await callHealth();

    expect(status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.data.status).toBe('unhealthy');
    expect(body.data.checks.database).toEqual({ status: 'unhealthy', responseTime: null });
    expect(body.data.checks.redis.status).toBe('healthy');
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.20\.30|railway_owner/);
    expect(logger.error).toHaveBeenCalledWith('Database health check failed', { error: DB_FAILURE });
  });

  test.each([
    ['не отвечает на PING', () => redisClient.ping.mockRejectedValue(new Error(REDIS_FAILURE)), REDIS_FAILURE],
    ['переподключается', () => { redisClient.isReady = false; }, 'Redis client is not ready (reconnecting)'],
  ])('Redis %s — 503, «сбой» без текста ошибки; текст — в журнале', async (_label, breakRedis, logged) => {
    breakRedis();

    const { status, body } = await callHealth();

    expect(status).toBe(503);
    expect(body.data.checks.redis).toEqual({ status: 'unhealthy', responseTime: null });
    expect(body.data.checks.database.status).toBe('healthy');
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.20\.30|reconnecting/);
    expect(logger.error).toHaveBeenCalledWith('Redis health check failed', { error: logged });
  });
});
