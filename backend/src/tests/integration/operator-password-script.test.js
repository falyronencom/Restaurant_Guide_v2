/* eslint-env jest */
/**
 * Смена пароля оператором завершает все сеансы аккаунта — как сброс пароля
 * (scripts/lib/operator-password.js, отметка миграции 035).
 *
 * set-partner-password.js и ветки обновления create-admin.js и
 * create-viewer.js пишут пароль мимо сервера. До 12.10 они меняли
 * password_hash и только: устройство, вошедшее со старым паролем, работало
 * дальше — по refresh-токену 30 дней, по access-токену до 4 ч.
 *
 * Что проверяется для каждого из трёх:
 *   - access-токен, выданный до смены, получает 401 TOKEN_REVOKED;
 *   - refresh-токен, выданный до смены, — 401 TOKEN_REVOKED;
 *   - вход с новым паролем работает, его сеанс обновляется.
 * create-viewer.js и create-admin.js запускаются как есть, на базе теста:
 * процесс наследует DB_*, а флага --production здесь нет и быть не должно —
 * в основном checkout рядом лежит backend/.env.production. set-partner-password.js
 * пишет только в прод и потому не запускается: проверена его запись,
 * setActiveAccountPassword, вызванная напрямую.
 *
 * Сервер держит статус аккаунта в кэше до ACCOUNT_STATUS_TTL_MS, а скрипт —
 * другой процесс и сбросить его не может (и говорит это в выводе). После
 * скрипта тест сбрасывает кэш сам — стоит за эти 10 с.
 *
 * С 15.10 (директива service_accounts, Б4) смена пароля оператором гасит и
 * push-устройства, и неиспользованные ссылки сброса: устройство и ссылка
 * заводятся до скрипта, после — их нет. Учётки панели входят через вход
 * панели: общий вход им сеанса не выдаёт (Б1).
 *
 * Ещё: пароль и отзыв — одна транзакция; схема без 035 — refresh-токены всё
 * равно сожжены, скрипт предупреждает. Токены — из настоящих регистрации и
 * входа (почему — session-revocation.test.js).
 */

import request from 'supertest';
import argon2 from 'argon2';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import app from '../../server.js';
import { getClient } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { ACCOUNT_STATUS_TTL_MS, invalidateAccountStatus } from '../../services/accountStatus.js';
import { storedRefreshToken } from '../../utils/refreshTokenStorage.js';
import { isPanelRole } from '../../config/panelRoles.js';
import {
  setActiveAccountPassword,
  writePasswordEndingSessions,
} from '../../../scripts/lib/operator-password.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '../../../scripts');
const MIGRATION_035 = join(HERE, '..', '..', '..', 'migrations', '035_sessions_revoked_at.sql');

const PASSWORD = 'OldPass123';
const NEW_PASSWORD = 'NewPass456';

/**
 * Запуск скрипта на базе теста. spawnSync держит цикл событий jest, но
 * соединений пула в это время никто не ждёт.
 */
const run = (script, args, env) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
  env: { ...process.env, ...env },
  encoding: 'utf8',
});

/** Аккаунт с ролью role и сеансом, открытым старым паролем. */
const openSession = async (role) => {
  const email = `operator-${randomUUID()}@test.com`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, name: 'Смена пароля', authMethod: 'email' })
    .expect(201);
  const userId = res.body.data.user.id;
  if (role !== 'user') {
    await query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);
    invalidateAccountStatus(userId);
  }
  // Push-устройство и живая ссылка сброса — их тоже гасит смена пароля оператором.
  await query("INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, $2, 'android')", [userId, `fcm-${randomUUID()}`]);
  await query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
    [userId, randomUUID().replace(/-/g, '').padEnd(64, '0')],
  );
  return {
    email,
    userId,
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
  };
};

/** Вход через дверь роли: учётке панели — вход панели (Б1). */
const login = async (email, password) => {
  const { rows: [account] } = await query('SELECT role FROM users WHERE email = $1', [email]);
  const door = isPanelRole(account.role) ? '/api/v1/admin/auth/login' : '/api/v1/auth/login';
  const res = await request(app)
    .post(door)
    .send({ email, password })
    .expect(200);
  return { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
};

/** Запрос с токеном, доступный любой роли; заодно греет кэш статуса аккаунта. */
const touch = (accessToken) => request(app)
  .get('/api/v1/notifications/unread-count')
  .set('Authorization', `Bearer ${accessToken}`);

const refresh = (refreshToken) => request(app)
  .post('/api/v1/auth/refresh')
  .send({ refreshToken });

const expectRevoked = (response) => {
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('TOKEN_REVOKED');
};

/** Сеанс, открытый до смены пароля, закрыт; вход с новым паролем работает. */
const expectOldSessionEnded = async (account) => {
  const { rows: [left] } = await query(
    `SELECT (SELECT COUNT(*)::int FROM device_tokens WHERE user_id = $1 AND is_active = TRUE) AS devices,
            (SELECT COUNT(*)::int FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL) AS reset_links`,
    [account.userId],
  );
  expect(left).toEqual({ devices: 0, reset_links: 0 });

  // Кэш статуса тёплый (touch до скрипта) и прожил бы до 10 с.
  invalidateAccountStatus(account.userId);
  expectRevoked(await touch(account.accessToken));
  expectRevoked(await refresh(account.refreshToken));

  const fresh = await login(account.email, NEW_PASSWORD);
  await touch(fresh.accessToken).expect(200);
  await refresh(fresh.refreshToken).expect(200);
};

/** Что скрипт говорит про окно кэша — число из настоящего ACCOUNT_STATUS_TTL_MS. */
const CACHE_WINDOW = new RegExp(`up to ${ACCOUNT_STATUS_TTL_MS / 1000} seconds`);

beforeEach(async () => {
  await clearAllData();
});

afterAll(async () => {
  await clearAllData();
});

describe('create-viewer.js: сброс существующего viewer завершает его сеансы', () => {
  test('старые access и refresh — 401 TOKEN_REVOKED, вход с новым паролем работает', async () => {
    const account = await openSession('viewer');
    await touch(account.accessToken).expect(200);

    const res = run('create-viewer.js', [`--email=${account.email}`, '--yes'], {
      VIEWER_PASSWORD: NEW_PASSWORD,
    });
    expect({ status: res.status, stderr: res.stderr }).toEqual({ status: 0, stderr: '' });

    await expectOldSessionEnded(account);
    expect(res.stdout).toMatch(/Sessions ended: 1 refresh token\(s\) burned/);
    expect(res.stdout).toMatch(CACHE_WINDOW);
  });
});

describe('create-admin.js: новый пароль существующей записи завершает её сеансы', () => {
  test('старые access и refresh — 401 TOKEN_REVOKED, вход с новым паролем работает', async () => {
    const account = await openSession('user');
    await touch(account.accessToken).expect(200);

    const res = run('create-admin.js', [`--email=${account.email}`, '--promote', '--yes'], {
      ADMIN_PASSWORD: NEW_PASSWORD,
    });
    expect({ status: res.status, stderr: res.stderr }).toEqual({ status: 0, stderr: '' });

    await expectOldSessionEnded(account);
    expect(res.stdout).toMatch(/Sessions ended: 1 refresh token\(s\) burned/);
    expect(res.stdout).toMatch(CACHE_WINDOW);
    // Пароль приходит переменной окружения, чтобы не оседать в истории
    // оболочки, — и в выводе ему тоже не место.
    expect(res.stdout).not.toContain(NEW_PASSWORD);
  });
});

describe('set-partner-password.js: его запись (скрипт пишет только в прод)', () => {
  const setPassword = async (email) => {
    const client = await getClient();
    try {
      return await setActiveAccountPassword(client, email, await argon2.hash(NEW_PASSWORD));
    } finally {
      client.release();
    }
  };

  test('старые access и refresh — 401 TOKEN_REVOKED, вход с новым паролем работает', async () => {
    const account = await openSession('partner');
    await touch(account.accessToken).expect(200);

    const { account: updated, sessions } = await setPassword(account.email);
    expect(updated).toEqual({ id: account.userId, email: account.email });
    expect(sessions).toMatchObject({ refreshTokens: 1, devices: 1, resetLinks: 1 });
    expect(sessions.revokedAt).toBeInstanceOf(Date);

    await expectOldSessionEnded(account);
  });

  test('выключенный аккаунт: пароль не пишется, сеансы не трогаются', async () => {
    const account = await openSession('partner');
    await query('UPDATE users SET is_active = false WHERE id = $1', [account.userId]);

    expect(await setPassword(account.email)).toEqual({ account: undefined, sessions: null });

    const { rows: [token] } = await query(
      'SELECT used_at FROM refresh_tokens WHERE token = $1',
      [storedRefreshToken(account.refreshToken)],
    );
    expect(token.used_at).toBeNull();
  });
});

describe('пароль и отзыв — одна транзакция', () => {
  test('отзыв упал — пароль не записан, соединение вне транзакции', async () => {
    const account = await openSession('partner');
    const client = await getClient();
    try {
      await expect(writePasswordEndingSessions(client, async (tx) => {
        await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
          account.userId,
          await argon2.hash(NEW_PASSWORD),
        ]);
        return { id: 'not-a-uuid' };
      })).rejects.toThrow(/uuid/);
      // Транзакция, брошенная без ROLLBACK, отвергла бы и этот запрос.
      await client.query('SELECT 1');
    } finally {
      client.release();
    }

    await login(account.email, PASSWORD);
  });
});

describe('схема без миграции 035', () => {
  const dropColumn = () => query(
    `BEGIN;
     SET LOCAL lock_timeout = '5s';
     ALTER TABLE users DROP COLUMN sessions_revoked_at;
     COMMIT;`,
  );
  const restoreColumn = () => query(readFileSync(MIGRATION_035, 'utf8').replace(/\r\n/g, '\n'));

  test('create-viewer.js: пароль записан, refresh-токены сожжены, скрипт предупреждает', async () => {
    await dropColumn();
    try {
      const account = await openSession('viewer');

      const res = run('create-viewer.js', [`--email=${account.email}`, '--yes'], {
        VIEWER_PASSWORD: NEW_PASSWORD,
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toMatch(/Migration 035 is not applied/);
      expect(res.stderr).toMatch(/1 refresh token\(s\) burned/);
      expect(res.stdout).not.toMatch(/Sessions ended/);

      const { rows: [token] } = await query(
        'SELECT used_at FROM refresh_tokens WHERE token = $1',
        [storedRefreshToken(account.refreshToken)],
      );
      expect(token.used_at).not.toBeNull();

      // Как до 035: access-токен живёт до своего срока.
      invalidateAccountStatus(account.userId);
      await touch(account.accessToken).expect(200);

      const fresh = await login(account.email, NEW_PASSWORD);
      await touch(fresh.accessToken).expect(200);
    } finally {
      await restoreColumn();
    }
  });
});
