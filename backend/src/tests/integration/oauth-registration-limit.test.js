/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Новая учётка через Google или Яндекс тратит суточный предел новых учёток с
 * адреса, один на все пути; вход в существующую учётку его не тратит и в него не
 * упирается (нитка «Общий потолок распознавания», № 3; находка 3 нитки «Расходы
 * посторонних»).
 *
 * У каждой учётки свои суточные бюджеты: POST /auth/register ограничен 20 в сутки
 * с адреса, а первый вход через провайдера создавал учётку мимо этого счёта.
 * Создаёт ли вход учётку, известно только после проверки токена, поэтому лимитер
 * маршрута здесь не встанет: счётчик тратит сам обработчик
 * (middleware/rateLimiter.js spendRouteLimit). Счётчик запросов к регистрации —
 * отдельный: двадцать отказанных запросов не закрывают вход новым людям за тем же
 * адресом (ревью по линзе).
 *
 * Настоящие контроллер, сервис, база и Redis; подменена только граница
 * провайдера: google-auth-library и fetch к login.yandex.ru. Счётчик дня ставится
 * прямо в Redis перед границей. Ожидания — литералы: 20 в сутки, текст лимитеров.
 */
import { jest } from '@jest/globals';
import { minskDate } from '../../utils/minskDay.js';

/** The number of the Minsk day — the day bucket of every day-long limiter (middleware/rateLimiter.js bucketAt). */
const minskDayIndex = () => Date.parse(`${minskDate(new Date(Date.now()))}T00:00:00.000Z`) / 86400000;

const mockVerifyIdToken = jest.fn();
const MockOAuth2Client = jest.fn();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

const request = (await import('supertest')).default;
const app = (await import('../../server.js')).default;
const { default: redisClient, connectRedis } = await import('../../config/redis.js');
const { addressKey } = await import('../../utils/clientAddress.js');
const { clearAllData, query } = await import('../utils/database.js');
const { createTestUser } = await import('../utils/auth.js');
const { oauthProviderResponses } = await import('../fixtures/users.js');

const DUMMY_TOKEN = 'oauth-token-1234567890';
const LIMITER_TEXT = 'Слишком много запросов. Попробуйте позже.';
const SITE_SECRET = 'site-secret-of-this-test-long-enough-to-count';
const SITE_VISITOR = '203.0.113.77';
const OTHER_VISITOR = '203.0.113.78';

const dayIndex = () => minskDayIndex();

/** Счётчик новых учёток адреса за сутки. */
const dayKey = (address = '::ffff:127.0.0.1') =>
  `ratelimit:new-accounts-day:${addressKey(address)}:${dayIndex()}`;

/** Счётчик запросов к POST /auth/register с адреса за сутки. */
const requestsKey = () => `ratelimit:register-day:${addressKey('::ffff:127.0.0.1')}:${dayIndex()}`;

const setCount = (value, key = dayKey()) => redisClient.set(key, String(value), { EX: 3600 });
const count = async (key = dayKey()) => redisClient.get(key);

const sweep = async () => {
  for (const prefix of ['register', 'register-day', 'new-accounts-day', 'oauth']) {
    const keys = await redisClient.keys(`ratelimit:${prefix}:*`);
    if (keys.length > 0) await redisClient.del(keys);
  }
};

const usersWith = async (email) => (await query('SELECT id FROM users WHERE email = $1', [email])).rows;

const postGoogle = (overrides = {}, headers = {}) => {
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ ...oauthProviderResponses.google, ...overrides }),
  });
  return request(app).post('/api/v1/auth/oauth').set(headers).send({ provider: 'google', token: DUMMY_TOKEN });
};

const postYandex = (overrides = {}) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ...oauthProviderResponses.yandex, ...overrides }),
  });
  return request(app).post('/api/v1/auth/oauth').send({ provider: 'yandex', token: DUMMY_TOKEN });
};

const register = (email, overrides = {}) => request(app).post('/api/v1/auth/register').send({
  email,
  name: 'Суточный',
  password: 'Daylimit123!@#',
  authMethod: 'email',
  ...overrides,
});

const GOOGLE_EMAIL = oauthProviderResponses.google.email;
const YANDEX_EMAIL = oauthProviderResponses.yandex.default_email;

let savedFetch;

beforeAll(async () => {
  savedFetch = global.fetch;
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) throw new Error('Redis connection is required: the limiter counts there');
  }
});

beforeEach(async () => {
  await clearAllData();
  await sweep();
  // resetMocks:true wipes the factory impl each test (feedback_jest_resetmocks).
  MockOAuth2Client.mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken }));
});

afterEach(() => {
  global.fetch = savedFetch;
});

afterAll(async () => {
  await sweep();
  await clearAllData();
});

describe('новая учётка тратит предел новых учёток с адреса', () => {
  test.each([
    ['Google', () => postGoogle()],
    ['Яндекс', () => postYandex()],
  ])('%s: первая учётка считается в счётчике дня этого адреса', async (_label, post) => {
    await post().expect(200);

    expect(await count()).toBe('1');
  });

  test.each([
    ['Google', postGoogle, GOOGLE_EMAIL, (email) => ({ sub: `sub-${email}`, email })],
    ['Яндекс', postYandex, YANDEX_EMAIL, (email) => ({ id: `id-${email}`, default_email: email })],
  ])('%s: 20-я за сутки — создана, 21-я — 429 с текстом лимитеров, записи нет, счётчик прежний', async (_label, post, email, another) => {
    await setCount(19);

    await post().expect(200);
    expect(await usersWith(email)).toHaveLength(1);
    expect(await count()).toBe('20');

    const refusedEmail = 'next-one@example.com';
    const refused = await post(another(refusedEmail)).expect(429);

    expect(refused.body.success).toBe(false);
    expect(refused.body.message).toBe(LIMITER_TEXT);
    expect(refused.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(refused.body.error.details.limit).toBe(20);
    expect(refused.body.error.details.window).toBe('86400 seconds');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(86400);
    expect(refused.body.data).toBeUndefined();
    expect(await usersWith(refusedEmail)).toEqual([]);
    expect(await count()).toBe('20');
  });

  test('один счёт на два пути: вход создал двадцатую — регистрация почтой получает отказ', async () => {
    await setCount(19);

    await postGoogle().expect(200);

    const refused = await register('by-mail@example.com').expect(429);
    expect(refused.body.message).toBe(LIMITER_TEXT);
    expect(await usersWith('by-mail@example.com')).toEqual([]);
    expect(await count()).toBe('20');
  });

  test('один счёт на два пути: регистрация почтой создала двадцатую — вход с новой учёткой получает отказ', async () => {
    await setCount(19);

    await register('by-mail@example.com').expect(201);
    expect(await count()).toBe('20');

    await postGoogle().expect(429);
    expect(await usersWith(GOOGLE_EMAIL)).toEqual([]);
  });

  test('учётка не создана (две первых записи столкнулись) — место в счётчике вернулось', async () => {
    await setCount(5);
    await query(`CREATE FUNCTION test_oauth_conflict() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE unique_violation USING CONSTRAINT = 'users_email_key'; END $$`);
    await query(`CREATE TRIGGER test_oauth_conflict BEFORE INSERT ON users
      FOR EACH ROW EXECUTE FUNCTION test_oauth_conflict()`);
    let res;
    try {
      res = await postGoogle();
    } finally {
      await query('DROP TRIGGER IF EXISTS test_oauth_conflict ON users');
      await query('DROP FUNCTION IF EXISTS test_oauth_conflict()');
    }

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACCOUNT_CONFLICT');
    expect(await count()).toBe('5');
  });

  test('посетитель сайта считается по адресу, за который ручается сайт', async () => {
    process.env.SITE_REQUEST_SECRET = SITE_SECRET;
    try {
      const asVisitor = (visitor) => ({ 'X-Site-Secret': SITE_SECRET, 'X-Site-Visitor': visitor });
      await setCount(20, dayKey(SITE_VISITOR));

      await postGoogle({}, asVisitor(SITE_VISITOR)).expect(429);
      expect(await usersWith(GOOGLE_EMAIL)).toEqual([]);

      await postGoogle({}, asVisitor(OTHER_VISITOR)).expect(200);
      expect(await count(dayKey(OTHER_VISITOR))).toBe('1');
      expect(await count()).toBeNull();
    } finally {
      process.env.SITE_REQUEST_SECRET = '';
    }
  });

  test('токен, не прошедший проверку, предела не тратит', async () => {
    await setCount(7);
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

    await request(app).post('/api/v1/auth/oauth').send({ provider: 'google', token: DUMMY_TOKEN }).expect(401);

    expect(await count()).toBe('7');
  });
});

describe('запросы, которые учётку не создали, вход новым людям не закрывают', () => {
  test('день запросов к регистрации выбран: регистрация отказывает, новая учётка через Google создаётся', async () => {
    await setCount(20, requestsKey());

    await register('by-mail@example.com').expect(429);

    await postGoogle().expect(200);
    expect(await usersWith(GOOGLE_EMAIL)).toHaveLength(1);
    expect(await count()).toBe('1');
  });

  test('проверка полей отказала — места в счёте новых учёток не тратит', async () => {
    await register('by-mail@example.com', { password: 'short' }).expect(422);

    expect(await count()).toBeNull();
    expect(await count(requestsKey())).toBe('1');
  });

  test('адрес занят — место возвращается; запрос к регистрации всё равно засчитан', async () => {
    await createTestUser({
      email: 'taken@example.com', name: 'Уже есть', password: 'Existing123!@#', authMethod: 'email',
    });
    await setCount(5);

    await register('taken@example.com').expect(409);

    expect(await count()).toBe('5');
    expect(await count(requestsKey())).toBe('1');
  });

  test('регистрация почтой тратит оба счёта по одному', async () => {
    await register('by-mail@example.com').expect(201);

    expect(await count()).toBe('1');
    expect(await count(requestsKey())).toBe('1');
  });
});

describe('вход в существующую учётку предела не тратит и в него не упирается', () => {
  test.each([
    ['Google', postGoogle],
    ['Яндекс', postYandex],
  ])('%s: при исчерпанном пределе существующая учётка входит, счётчик прежний', async (_label, post) => {
    await post().expect(200);
    expect(await count()).toBe('1');
    await setCount(20);

    await post().expect(200);

    expect(await count()).toBe('20');
  });

  test('вход в существующую учётку при неисчерпанном пределе счётчик не двигает', async () => {
    await postGoogle().expect(200);
    await setCount(3);

    await postGoogle().expect(200);

    expect(await count()).toBe('3');
  });

  test('привязка к учётке с подтверждённой почтой при исчерпанном пределе: вход есть, новой записи нет, счётчик прежний', async () => {
    const existing = await createTestUser({
      email: GOOGLE_EMAIL, name: 'Уже есть', password: 'Existing123!@#', authMethod: 'email',
    });
    await query('UPDATE users SET email_verified = true WHERE id = $1', [existing.id]);
    await setCount(20);

    const res = await postGoogle().expect(200);

    expect(res.body.data.user.id).toBe(existing.id);
    expect(await count()).toBe('20');
  });

  test('запись с неподтверждённой почтой переходит к владельцу адреса при исчерпанном пределе: новой записи нет, счётчик прежний', async () => {
    const existing = await createTestUser({
      email: GOOGLE_EMAIL, name: 'Самозванец', password: 'Existing123!@#', authMethod: 'email',
    });
    await setCount(20);

    const res = await postGoogle().expect(200);

    expect(res.body.data.user.id).toBe(existing.id);
    expect(await usersWith(GOOGLE_EMAIL)).toHaveLength(1);
    expect(await count()).toBe('20');
  });
});
