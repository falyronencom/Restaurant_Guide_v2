/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Нитка «Расходы посторонних», п. 6 (03.11.2026): у каждой учётки свои
 * бюджеты, поэтому регистрации с одного адреса умножали их без конца. Теперь
 * с адреса — не больше 30 регистраций в сутки (routes/v1/authRoutes.js
 * REGISTRATIONS_PER_DAY), а запрос к базе держит соединение не дольше 30 с
 * (config/database.js statementTimeoutMs). Счётчик дня задаётся прямо в
 * Redis: двадцать регистраций в минуту ограничены своим лимитером раньше.
 * Ожидаемые числа — литералы.
 */

import request from 'supertest';
import app from '../../server.js';
import pool from '../../config/database.js';
import redisClient, { connectRedis } from '../../config/redis.js';
import { RATE_LIMIT_MESSAGE } from '../../constants/rateLimitRefusal.js';
import { addressKey } from '../../utils/clientAddress.js';
import { clearAllData } from '../utils/database.js';

const sweep = async () => {
  const keys = [
    ...await redisClient.keys('ratelimit:register:*'),
    ...await redisClient.keys('ratelimit:register-day:*'),
  ];
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

/** The day counter of the address supertest calls from. */
const dayKey = () => `ratelimit:register-day:${addressKey('::ffff:127.0.0.1')}:${Math.floor(Date.now() / 86400000)}`;

let n = 0;
const register = () => {
  n += 1;
  return request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `day-limit-${n}@example.com`,
      name: 'Суточный',
      password: 'Daylimit123!@#',
      authMethod: 'email',
    });
};

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required: the limiter counts there');
    }
  }
});

beforeEach(async () => {
  await clearAllData();
  await sweep();
});

afterAll(async () => {
  await sweep();
  await clearAllData();
});

describe('регистрации с одного адреса за сутки', () => {
  test('первая регистрация считается в счётчике дня этого адреса', async () => {
    await register().expect(201);

    expect(await redisClient.get(dayKey())).toBe('1');
  });

  test('30-я за сутки — принята, 31-я — 429 с текстом лимитеров', async () => {
    await redisClient.set(dayKey(), '29', { EX: 3600 });
    await register().expect(201);

    const refused = await register().expect(429);

    expect(refused.body.message).toBe(RATE_LIMIT_MESSAGE);
    expect(refused.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(refused.body.error.details.limit).toBe(30);
    expect(refused.headers['retry-after']).toBeDefined();
  });
});

describe('предел времени запроса к базе', () => {
  test('у соединений пула — 30 с', async () => {
    const result = await pool.query('SHOW statement_timeout');

    expect(result.rows[0].statement_timeout).toBe('30s');
  });
});
