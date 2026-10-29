/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Вход в панель держится сутки без захода; отказ двери панели другой роли
 * ничего не пишет (решение Координатора 29.10.2026, S1 вариант «а», и п. 23;
 * сверка docs/handoffs/railway_incident_20261022/PANEL_SECURITY_S1_S4_VERIFY_20261029.md).
 *
 * Ожидания:
 *   S1. Учётка панели (admin, viewer), не продлевавшая вход сутки, продлить
 *       его не может — 401 TOKEN_EXPIRED, нужен новый вход. Ровно сутки без
 *       минуты — продлевает. Пока работает, продлевает сколько угодно раз.
 *       Остальные роли — как было: 30 дней. Правило действует и на ключи,
 *       выданные до него: строка ключа не меняется (expires_at — те же
 *       30 дней), проверяется возраст ключа при продлении.
 *       Сигнализация о краже (повтор уже использованного ключа) и отказ
 *       выключенной учётке остаются прежними и для ключа старше суток.
 *   п. 23. Верный пароль учётки другой роли на входе в панель — отказ 403,
 *       «последний вход» не пишется, сеанса нет, почты в журнале нет.
 *
 * Возраст ключа ставится голым JS Date, как его пишет generateTokenPair:
 * колонка наивная, сервер читает её в JS тем же местным временем, так что
 * возраст верен в любом поясе процесса (память feedback_timezone_axis, §5,
 * исключение). Допуск у границ — минута, не часы.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import logger from '../../utils/logger.js';
import { generateTokenPair } from '../../services/authService.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestUser } from '../utils/auth.js';
import { storedRefreshToken } from '../../utils/refreshTokenStorage.js';

const PASSWORD = 'Panel-Idle-123';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const GRACE_ENV = 'REFRESH_REUSE_GRACE_SECONDS';
const originalGrace = process.env[GRACE_ENV];

beforeEach(async () => {
  await clearAllData();
  process.env[GRACE_ENV] = '60';
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
  if (originalGrace === undefined) {
    delete process.env[GRACE_ENV];
  } else {
    process.env[GRACE_ENV] = originalGrace;
  }
});

const refresh = (refreshToken) => request(app).post('/api/v1/auth/refresh').send({ refreshToken });

const account = (role) => createTestUser({
  email: `${role}-idle@example.com`,
  password: PASSWORD,
  name: 'Учётка',
  role,
});

/** A session as every door opens one (panel login, shared login, OAuth). */
const sessionOf = async (user) => (await generateTokenPair(user)).refreshToken;

/** The token was created `ms` ago — bare Date, as generateTokenPair writes it. */
const ageToken = (refreshToken, ms) => query(
  'UPDATE refresh_tokens SET created_at = $1 WHERE token = $2',
  [new Date(Date.now() - ms), storedRefreshToken(refreshToken)],
);

const rowOf = async (refreshToken) => (await query(
  'SELECT expires_at, created_at, used_at FROM refresh_tokens WHERE token = $1',
  [storedRefreshToken(refreshToken)],
)).rows[0];

describe('S1: a panel session lives a day without a renewal', () => {
  test.each([
    ['admin', DAY - MINUTE, 200],
    ['admin', DAY + MINUTE, 401],
    ['viewer', DAY - MINUTE, 200],
    ['viewer', DAY + MINUTE, 401],
  ])('%s, token %p ms old → %p', async (role, age, status) => {
    const user = await account(role);
    const token = await sessionOf(user);
    await ageToken(token, age);

    const res = await refresh(token);

    expect(res.status).toBe(status);
    if (status === 401) {
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
      // Answered as expired, nothing burned: no reuse alarm can follow from it.
      expect((await rowOf(token)).used_at).toBeNull();
    } else {
      expect(res.body.data.user.role).toBe(role);
    }
  });

  test.each(['user', 'partner'])('%s: unchanged — a day old and 29 days old still renew', async (role) => {
    const user = await account(role);

    const dayOld = await sessionOf(user);
    await ageToken(dayOld, DAY + MINUTE);
    await refresh(dayOld).expect(200);

    const monthOld = await sessionOf(user);
    await ageToken(monthOld, 29 * DAY);
    await refresh(monthOld).expect(200);
  });

  test('a moderator at work is never logged out: each renewal starts the day again', async () => {
    const user = await account('admin');
    let token = await sessionOf(user);

    // Three renewals, each 23 h after the previous one — 69 h in all.
    for (let i = 0; i < 3; i += 1) {
      await ageToken(token, DAY - 60 * MINUTE);
      const res = await refresh(token).expect(200);
      token = res.body.data.refreshToken;
    }
  });

  test('a panel token issued before the rule — 30-day row, two days old — no longer renews', async () => {
    const user = await account('admin');
    const token = 'panel-token-issued-before-the-day-rule-0123456789abcdef';
    const created = new Date(Date.now() - 2 * DAY);
    const expires = new Date(created);
    expires.setDate(expires.getDate() + 30);
    // The row exactly as generateTokenPair wrote it until now.
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at, used_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NULL)`,
      [user.id, storedRefreshToken(token), expires, created],
    );

    const res = await refresh(token).expect(401);

    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  test('the row keeps its 30-day expires_at — the pruner orders chains by it', async () => {
    const user = await account('viewer');
    const token = await sessionOf(user);

    const row = await rowOf(token);
    const lifetime = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime();

    expect(Math.abs(lifetime - 30 * DAY)).toBeLessThan(2 * 60 * MINUTE); // DST tolerance
  });

  test('a burned panel token older than a day still raises the theft alarm and ends the thief\'s chain', async () => {
    const user = await account('admin');
    const stolen = await sessionOf(user);
    // The thief renews first; the moderator comes back two days later with
    // the token the thief has already spent.
    const thief = (await refresh(stolen).expect(200)).body.data.refreshToken;
    await query(
      "UPDATE refresh_tokens SET used_at = NOW() - interval '2 days' WHERE token = $1",
      [storedRefreshToken(stolen)],
    );
    await ageToken(stolen, 2 * DAY + 60 * MINUTE);

    const res = await refresh(stolen).expect(403);

    expect(res.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    // Burned by the alarm: refused like any other burned token, never served.
    expect([401, 403]).toContain((await refresh(thief)).status);
  });

  test('a switched-off panel account keeps its own answer for a token older than a day, and the token is burned', async () => {
    const user = await account('viewer');
    const token = await sessionOf(user);
    await ageToken(token, DAY + MINUTE);
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);

    const res = await refresh(token).expect(401);

    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
    expect((await rowOf(token)).used_at).not.toBeNull();
  });
});

describe('п. 23: the panel door refuses another role without writing anything about it', () => {
  const panelLogin = (email, password = PASSWORD) =>
    request(app).post('/api/v1/admin/auth/login').send({ email, password });

  const lastLoginOf = async (id) =>
    (await query('SELECT last_login_at FROM users WHERE id = $1', [id])).rows[0].last_login_at;

  const sessionsOf = async (id) =>
    (await query('SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE user_id = $1', [id])).rows[0].n;

  /** Everything the request handed to the logger, as one string. */
  const spyLogs = () => {
    const calls = ['info', 'warn', 'error'].map((level) => jest.spyOn(logger, level));
    return () => JSON.stringify(calls.map((spy) => spy.mock.calls));
  };

  test.each(['user', 'partner'])('%s with a right password: 403, no last login, no session, no e-mail in the log', async (role) => {
    const user = await account(role);
    const logged = spyLogs();

    const res = await panelLogin(user.email);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ADMIN_ACCESS_REQUIRED');
    expect(await lastLoginOf(user.id)).toBeNull();
    expect(await sessionsOf(user.id)).toBe(0);
    expect(logged()).not.toContain(user.email);
    // The refusal is still logged — by the account's id.
    expect(logged()).toContain(user.id);
  });

  test('control: a panel account at the same door gets in and its last login is written', async () => {
    const user = await account('admin');

    await panelLogin(user.email).expect(200);

    expect(await lastLoginOf(user.id)).not.toBeNull();
  });

  test('a wrong password of another role is still 401, not 403', async () => {
    const user = await account('partner');

    const res = await panelLogin(user.email, 'Wrong-Pass-456');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
