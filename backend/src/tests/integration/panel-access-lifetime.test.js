/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Вход в панель — мелочи (решение Координатора 29.10.2026, после PR #155).
 *
 * Ожидания:
 *   1. Короткий ключ учётки панели (admin, viewer) живёт час — и при входе,
 *      и при продлении, и при повторе продления в окне прощения; клиенту
 *      сообщается тот же срок (expiresIn). Остальные роли — как было: 4 ч
 *      (JWT_ACCESS_EXPIRY в .env.test и CI). Роль — учётки, не двери.
 *   3. Неверный пароль на любом входе по паролю (общий вход, вход в панель)
 *      не пишет в журнал ни почту, ни телефон человека — ни в строке «Login
 *      attempt failed», ни в соседних строках этого пути; вместо них — по чему
 *      входили и номер учётки, если она есть (при почте и телефоне сразу —
 *      без номера: найденная учётка может быть учёткой телефона). Вход через
 *      Google и Яндекс — другой путь, здесь не проверяется.
 * Предупреждение при старте (п. 2) — unit/access-expiry-startup.test.js.
 */
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import redisClient, { connectRedis } from '../../config/redis.js';
import { clearAllData } from '../utils/database.js';
import { createTestUser } from '../utils/auth.js';

const PASSWORD = 'Panel-Lifetime-123';
const HOUR = 3600;
const FOUR_HOURS = 4 * HOUR;

const GRACE_ENV = 'REFRESH_REUSE_GRACE_SECONDS';
const originalGrace = process.env[GRACE_ENV];

const PHONES = {
  admin: '+375447000001',
  viewer: '+375447000002',
  user: '+375297000003',
  partner: '+375337000004',
};

const emailOf = (role) => `${role}-lifetime@example.com`;

/** Login counters are kept per address, and supertest's address never changes. */
const clearLoginCounters = async () => {
  for (const prefix of ['login', 'admin-login']) {
    const keys = await redisClient.keys(`ratelimit:${prefix}:*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
};

beforeAll(async () => {
  if (!redisClient.isReady) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required for the login counters');
    }
  }
});

beforeEach(async () => {
  await clearAllData();
  await clearLoginCounters();
  process.env[GRACE_ENV] = '60';
  for (const role of ['admin', 'viewer', 'user', 'partner']) {
    await createTestUser({
      email: emailOf(role),
      phone: PHONES[role],
      password: PASSWORD,
      name: 'Учётка',
      role,
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
  await clearLoginCounters();
  if (originalGrace === undefined) {
    delete process.env[GRACE_ENV];
  } else {
    process.env[GRACE_ENV] = originalGrace;
  }
});

const panelLogin = (body) => request(app).post('/api/v1/admin/auth/login').send(body);
const sharedLogin = (body) => request(app).post('/api/v1/auth/login').send(body);
const refresh = (refreshToken) => request(app).post('/api/v1/auth/refresh').send({ refreshToken });

/** The lifetime the token itself carries. */
const lifetimeOf = (accessToken) => {
  const { iat, exp } = jwt.decode(accessToken);
  return exp - iat;
};

/** What a response says and what its token carries — they must agree. */
const lifetimes = (res) => ({
  told: res.body.data.expiresIn,
  carried: lifetimeOf(res.body.data.accessToken),
});

describe('1: a panel access token lives an hour, the other roles 4 h', () => {
  test.each(['admin', 'viewer'])('%s through the panel\'s login: 1 h', async (role) => {
    const res = await panelLogin({ email: emailOf(role), password: PASSWORD }).expect(200);

    expect(res.body.data.user.role).toBe(role);
    expect(lifetimes(res)).toEqual({ told: HOUR, carried: HOUR });
  });

  test.each(['user', 'partner'])('%s through the shared login: 4 h, as before', async (role) => {
    const res = await sharedLogin({ email: emailOf(role), password: PASSWORD }).expect(200);

    expect(res.body.data.user.role).toBe(role);
    expect(lifetimes(res)).toEqual({ told: FOUR_HOURS, carried: FOUR_HOURS });
  });

  test('a renewal keeps the role\'s lifetime: viewer 1 h, user 4 h', async () => {
    const viewer = await panelLogin({ email: emailOf('viewer'), password: PASSWORD }).expect(200);
    const user = await sharedLogin({ email: emailOf('user'), password: PASSWORD }).expect(200);

    const viewerRenewed = await refresh(viewer.body.data.refreshToken).expect(200);
    const userRenewed = await refresh(user.body.data.refreshToken).expect(200);

    expect(lifetimes(viewerRenewed)).toEqual({ told: HOUR, carried: HOUR });
    expect(lifetimes(userRenewed)).toEqual({ told: FOUR_HOURS, carried: FOUR_HOURS });
  });

  test('a renewal replayed inside the grace window: still 1 h for the panel', async () => {
    const admin = await panelLogin({ email: emailOf('admin'), password: PASSWORD }).expect(200);
    const token = admin.body.data.refreshToken;

    const first = await refresh(token).expect(200);
    const replay = await refresh(token).expect(200);

    // The replay is answered from the same successor (config/auth.js).
    expect(replay.body.data.refreshToken).toBe(first.body.data.refreshToken);
    expect(lifetimes(replay)).toEqual({ told: HOUR, carried: HOUR });
  });
});

describe('3: a wrong password writes neither the e-mail nor the phone to the log', () => {
  /** Every log line written while `act` runs, as text. */
  const logWhile = async (act) => {
    const calls = [];
    for (const level of ['error', 'warn', 'info', 'debug']) {
      jest.spyOn(logger, level).mockImplementation((...args) => {
        calls.push({ level, args });
        return logger;
      });
    }
    await act();
    return calls;
  };

  const failures = (calls) => calls
    .filter(({ args }) => args[0] === 'Login attempt failed')
    .map(({ args }) => args[1]);

  const expectNoPersonalData = (calls) => {
    const text = JSON.stringify(calls).toLowerCase();
    Object.keys(PHONES).forEach((role) => {
      expect(text).not.toContain(emailOf(role));
      expect(text).not.toContain(PHONES[role]);
      // The phone without its plus, as a log might print it.
      expect(text).not.toContain(PHONES[role].slice(1));
    });
    expect(text).not.toContain('nobody-lifetime@example.com');
    expect(text).not.toContain('+375299999999');
  };

  test('shared login, by e-mail: the account by its id, the door by «email»', async () => {
    const calls = await logWhile(async () => {
      await sharedLogin({ email: emailOf('user'), password: 'Wrong-Password-1' }).expect(401);
    });

    expectNoPersonalData(calls);
    expect(failures(calls)).toEqual([
      { loginBy: 'email', userId: expect.any(String), reason: 'invalid_password' },
    ]);
  });

  test('shared login, by phone: «phone», no phone', async () => {
    const calls = await logWhile(async () => {
      await sharedLogin({ phone: PHONES.partner, password: 'Wrong-Password-1' }).expect(401);
    });

    expectNoPersonalData(calls);
    expect(failures(calls)).toEqual([
      { loginBy: 'phone', userId: expect.any(String), reason: 'invalid_password' },
    ]);
  });

  test('an e-mail and a phone at once: «email_and_phone», no id — the row may be the phone\'s', async () => {
    const calls = await logWhile(async () => {
      // The user's e-mail, the partner's phone: the row found can be either.
      await sharedLogin({
        email: emailOf('user'), phone: PHONES.partner, password: 'Wrong-Password-1',
      }).expect(401);
    });

    expectNoPersonalData(calls);
    expect(failures(calls)).toEqual([
      { loginBy: 'email_and_phone', reason: 'invalid_password' },
    ]);
  });

  test('an unknown address: no account, no id, no address', async () => {
    const calls = await logWhile(async () => {
      await sharedLogin({ email: 'nobody-lifetime@example.com', password: 'Wrong-Password-1' }).expect(401);
      await sharedLogin({ phone: '+375299999999', password: 'Wrong-Password-1' }).expect(401);
    });

    expectNoPersonalData(calls);
    expect(failures(calls)).toEqual([
      { loginBy: 'email', reason: 'user_not_found' },
      { loginBy: 'phone', reason: 'user_not_found' },
    ]);
  });

  test('the panel\'s login, wrong password; a panel account on the shared login', async () => {
    const calls = await logWhile(async () => {
      await panelLogin({ email: emailOf('admin'), password: 'Wrong-Password-1' }).expect(401);
      await sharedLogin({ email: emailOf('viewer'), password: PASSWORD }).expect(401);
    });

    expectNoPersonalData(calls);
    expect(failures(calls)).toEqual([
      { loginBy: 'email', userId: expect.any(String), reason: 'invalid_password' },
      { loginBy: 'email', userId: expect.any(String), reason: 'panel_account_on_shared_login' },
    ]);
  });
});
