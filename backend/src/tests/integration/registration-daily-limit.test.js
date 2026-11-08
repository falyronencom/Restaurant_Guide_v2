/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Нитка «Расходы посторонних», пп. 2 и 6 (03.11.2026): у каждой учётки свои
 * бюджеты, поэтому регистрации с одного адреса умножали их без конца, а
 * письма проекта (100 в день у почтового сервиса) мог выбрать один адрес.
 * Теперь с адреса за сутки — не больше 20 регистраций, 10 повторных кодов
 * (на все его учётки) и 10 запросов сброса пароля (routes/v1/authRoutes.js),
 * а запрос к базе держит соединение не дольше 30 с (config/database.js
 * statementTimeoutMs). Счётчики дня задаются прямо в Redis: минутные и
 * часовые лимитеры сработали бы раньше. Ожидаемые числа — литералы.
 */

import request from 'supertest';
import app from '../../server.js';
import pool from '../../config/database.js';
import redisClient, { connectRedis } from '../../config/redis.js';
import { RATE_LIMIT_MESSAGE } from '../../constants/rateLimitRefusal.js';
import { addressKey } from '../../utils/clientAddress.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

const PREFIXES = ['register', 'register-day', 'new-accounts-day', 'verify-send', 'verify-send-address', 'forgot-password', 'forgot-password-day'];

const sweep = async () => {
  for (const prefix of PREFIXES) {
    const keys = await redisClient.keys(`ratelimit:${prefix}:*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
};

/** A day counter of the address supertest calls from. */
const dayKey = (prefix = 'register-day') =>
  `ratelimit:${prefix}:${addressKey('::ffff:127.0.0.1')}:${Math.floor(Date.now() / 86400000)}`;

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

  test('20-я за сутки — принята, 21-я — 429 с текстом лимитеров', async () => {
    await redisClient.set(dayKey(), '19', { EX: 3600 });
    await register().expect(201);

    const refused = await register().expect(429);

    expect(refused.body.message).toBe(RATE_LIMIT_MESSAGE);
    expect(refused.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(refused.body.error.details.limit).toBe(20);
    expect(refused.headers['retry-after']).toBeDefined();
  });
});

describe('письма с одного адреса за сутки', () => {
  test('повторный код: 10-й за сутки с адреса — принят, 11-й — 429, хотя учётка другая', async () => {
    const first = await createUserAndGetTokens({
      email: 'resend-a@example.com', name: 'Первый', password: 'Resend123!@#', authMethod: 'email',
    });
    const second = await createUserAndGetTokens({
      email: 'resend-b@example.com', name: 'Второй', password: 'Resend123!@#', authMethod: 'email',
    });
    await redisClient.set(dayKey('verify-send-address'), '9', { EX: 3600 });

    await request(app).post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${first.accessToken}`).expect(200);
    const refused = await request(app).post('/api/v1/auth/send-verification-code')
      .set('Authorization', `Bearer ${second.accessToken}`).expect(429);

    expect(refused.body.error.details.limit).toBe(10);
  });

  test('сброс пароля: 10-й запрос за сутки с адреса — принят, 11-й — 429', async () => {
    await redisClient.set(dayKey('forgot-password-day'), '9', { EX: 3600 });

    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'someone@example.com' }).expect(200);
    const refused = await request(app).post('/api/v1/auth/forgot-password')
      .send({ email: 'someone@example.com' }).expect(429);

    expect(refused.body.error.details.limit).toBe(10);
  });
});

describe('предел времени запроса к базе', () => {
  test('у соединений пула — 30 с', async () => {
    const result = await pool.query('SHOW statement_timeout');

    expect(result.rows[0].statement_timeout).toBe('30s');
  });
});
