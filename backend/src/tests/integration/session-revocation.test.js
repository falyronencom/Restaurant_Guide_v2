/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Завершение всех сеансов аккаунта: токены, выданные до события, не действуют
 * со следующего запроса (миграция 035, users.sessions_revoked_at; остаток
 * находки критиков F-18 / C-05).
 *
 * Все сеансы аккаунта завершают три события: сброс пароля, срабатывание защиты
 * от повторного предъявления refresh-токена и переход неподтверждённой записи
 * к владельцу адреса (последнее — в oauth-unverified-takeover.test.js, где
 * подменены провайдеры). До 035 они гасили только refresh-токены, а уже
 * выданный access-токен работал до своего срока — до 4 ч.
 *
 * Что проверяется:
 *   - старый access-токен после события получает 401 TOKEN_REVOKED — при
 *     ТЁПЛОМ кэше статуса аккаунта: до события тот же токен прошёл, значит
 *     кэш сброшен в самом процессе, а не дождался своих 10 с;
 *   - вход после события работает;
 *   - старый refresh-токен получает 401 TOKEN_REVOKED, а не 403 «повтор»:
 *     проснувшееся старое устройство не гасит сеанс, открытый после события;
 *   - граница — парой на миллисекунде метки;
 *   - код работает и на схеме без 035 — в окне между выкаткой кода и ручным
 *     применением миграции на проде.
 *
 * Токены — из настоящих регистрации и входа, не из тест-хелпера: created_at
 * refresh-токена сравнивается с меткой в JS, и только generateTokenPair
 * пишет его так, как это сравнение читает.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import app from '../../server.js';
import { getClient } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { invalidateAccountStatus, markSessionsRevoked } from '../../services/accountStatus.js';

const GRACE_ENV = 'REFRESH_REUSE_GRACE_SECONDS';
const originalGrace = process.env[GRACE_ENV];

const PASSWORD = 'OldPass123';
const NEW_PASSWORD = 'NewPass456';

const MIGRATION_035 = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'migrations', '035_sessions_revoked_at.sql',
);

const register = async () => {
  const email = `revoke-${randomUUID()}@test.com`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, name: 'Отзыв сеансов', authMethod: 'email' })
    .expect(201);
  return {
    email,
    userId: res.body.data.user.id,
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
  };
};

const login = async (email, password) => {
  const res = await request(app)
    .post('/api/v1/auth/login')
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

/** Сброс пароля по ссылке из письма: токен сброса кладётся хешем, как его пишет сервис. */
const resetPassword = async (userId) => {
  const rawToken = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '30 minutes')`,
    [userId, createHash('sha256').update(rawToken).digest('hex')],
  );
  await request(app)
    .post('/api/v1/auth/reset-password')
    .send({ token: rawToken, password: NEW_PASSWORD })
    .expect(200);
};

/**
 * Метка отзыва, поставленная напрямую — для пар на границе. Код после своей
 * записи сбрасывает кэш статуса; здесь это делает тест.
 */
const stampSessionsRevoked = async (userId, at) => {
  await query('UPDATE users SET sessions_revoked_at = $2 WHERE id = $1', [userId, at]);
  invalidateAccountStatus(userId);
};

const expectRevoked = (response) => {
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('TOKEN_REVOKED');
};

beforeEach(async () => {
  await clearAllData();
  process.env[GRACE_ENV] = '60';
});

afterAll(async () => {
  await clearAllData();
  if (originalGrace === undefined) {
    delete process.env[GRACE_ENV];
  } else {
    process.env[GRACE_ENV] = originalGrace;
  }
});

describe('сброс пароля завершает все сеансы аккаунта', () => {
  test('access-токен, выданный до сброса, со следующего запроса получает 401 TOKEN_REVOKED — тёплый кэш его не продлевает', async () => {
    const account = await register();
    await touch(account.accessToken).expect(200);

    await resetPassword(account.userId);

    expectRevoked(await touch(account.accessToken));
  });

  test('вход с новым паролем работает, и его сеанс переживает проснувшееся старое устройство', async () => {
    const account = await register();
    await resetPassword(account.userId);

    const fresh = await login(account.email, NEW_PASSWORD);
    await touch(fresh.accessToken).expect(200);

    // Старое устройство просыпается: его access-токен отвергнут, и обновить
    // его нечем — refresh-токен отозван сбросом. Ответ 401, не 403: это не
    // кража, и всех сеансов он заново не гасит.
    expectRevoked(await touch(account.accessToken));
    expectRevoked(await refresh(account.refreshToken));

    // Сеанс, открытый после сброса, жив: запрос проходит, токен обновляется.
    await touch(fresh.accessToken).expect(200);
    const rotated = await refresh(fresh.refreshToken).expect(200);
    await touch(rotated.body.data.accessToken).expect(200);
  });
});

describe('срабатывание защиты от повторного предъявления refresh-токена завершает все сеансы', () => {
  // Окно 0: повтор сожжённого токена — кража, а не потерянный ответ.
  beforeEach(() => {
    process.env[GRACE_ENV] = '0';
  });

  test('не действуют ни исходный access-токен, ни выданный ротацией до срабатывания', async () => {
    const account = await register();
    const rotated = await refresh(account.refreshToken).expect(200);
    await touch(account.accessToken).expect(200);
    await touch(rotated.body.data.accessToken).expect(200);

    // Украденная копия уже сожжённого токена предъявлена ещё раз.
    const alarm = await refresh(account.refreshToken).expect(403);
    expect(alarm.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    expectRevoked(await touch(account.accessToken));
    expectRevoked(await touch(rotated.body.data.accessToken));
    // Преемник, выданный законному клиенту, отозван тем же событием.
    expectRevoked(await refresh(rotated.body.data.refreshToken));
  });

  test('вход после срабатывания работает, и новый повтор украденного токена его не гасит', async () => {
    const account = await register();
    await refresh(account.refreshToken).expect(200);
    await refresh(account.refreshToken).expect(403);

    const fresh = await login(account.email, PASSWORD);
    await touch(fresh.accessToken).expect(200);

    // До 035 этот повтор снова гасил все сеансы — и только что открытый тоже.
    expectRevoked(await refresh(account.refreshToken));

    await touch(fresh.accessToken).expect(200);
    await refresh(fresh.refreshToken).expect(200);
  });
});

describe('граница — миллисекунда метки', () => {
  test('access-токен: выданный за 1 мс до метки отвергается, выданный в её миллисекунду проходит', async () => {
    const account = await register();
    const { iatMs } = jwt.decode(account.accessToken);

    await stampSessionsRevoked(account.userId, new Date(iatMs + 1));
    expectRevoked(await touch(account.accessToken));

    await stampSessionsRevoked(account.userId, new Date(iatMs));
    await touch(account.accessToken).expect(200);
  });

  test('access-токен без iatMs (выданный до 035) отсчитывается от начала своей секунды iat', async () => {
    const account = await register();
    const iat = Math.floor(Date.now() / 1000);
    const legacy = jwt.sign(
      { userId: account.userId, email: account.email, role: 'user', type: 'access', iat },
      process.env.JWT_SECRET,
      { expiresIn: '4h', issuer: 'restaurant-guide-belarus', audience: 'restaurant-guide-api' },
    );

    await stampSessionsRevoked(account.userId, new Date(iat * 1000 + 1));
    expectRevoked(await touch(legacy));

    await stampSessionsRevoked(account.userId, new Date(iat * 1000));
    await touch(legacy).expect(200);
  });

  test('refresh-токен: созданный за 1 мс до метки отвергается, созданный в её миллисекунду обновляется', async () => {
    const account = await register();
    // node-pg читает наивный created_at в поясе процесса — так же, как его
    // читает сравнение в authService; по этому чтению и ставится пара.
    const { rows: [row] } = await query(
      'SELECT created_at FROM refresh_tokens WHERE token = $1',
      [account.refreshToken],
    );
    const createdAtMs = new Date(row.created_at).getTime();

    await stampSessionsRevoked(account.userId, new Date(createdAtMs + 1));
    expectRevoked(await refresh(account.refreshToken));

    await stampSessionsRevoked(account.userId, new Date(createdAtMs));
    await refresh(account.refreshToken).expect(200);
  });
});

describe('метка не движется назад', () => {
  test('более ранняя запись (часы шагнули назад, два отзыва наперегонки) не отменяет более позднюю', async () => {
    const account = await register();
    const later = new Date(Date.now() + 60 * 60 * 1000);
    await stampSessionsRevoked(account.userId, later);

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await markSessionsRevoked(client, account.userId);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows: [row] } = await query(
      'SELECT sessions_revoked_at FROM users WHERE id = $1',
      [account.userId],
    );
    expect(row.sessions_revoked_at.getTime()).toBe(later.getTime());
  });
});

describe('схема без миграции 035 — окно между выкаткой кода и ручной миграцией', () => {
  const dropColumn = () => query(
    `BEGIN;
     SET LOCAL lock_timeout = '5s';
     ALTER TABLE users DROP COLUMN sessions_revoked_at;
     COMMIT;`,
  );
  // Возвращает колонку самой миграцией — заодно её повторяемость на чистой схеме.
  const restoreColumn = () => query(readFileSync(MIGRATION_035, 'utf8').replace(/\r\n/g, '\n'));

  test('вход, запросы, обновление, сброс пароля и тревога повтора — без 500 и 503; access-токены, как до 035, живут до срока', async () => {
    await dropColumn();
    try {
      const account = await register();
      await touch(account.accessToken).expect(200);
      const rotated = await refresh(account.refreshToken).expect(200);
      await touch(rotated.body.data.accessToken).expect(200);

      await resetPassword(account.userId);

      // Как до 035: refresh-токены сброс погасил, access-токен работает до срока.
      await touch(rotated.body.data.accessToken).expect(200);
      const stale = await refresh(rotated.body.data.refreshToken);
      expect(stale.status).toBe(403);
      expect(stale.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      const fresh = await login(account.email, NEW_PASSWORD);
      await touch(fresh.accessToken).expect(200);
    } finally {
      await restoreColumn();
    }

    const { rows } = await query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'sessions_revoked_at'`,
    );
    expect(rows).toEqual([{ data_type: 'timestamp with time zone' }]);
  });
});
