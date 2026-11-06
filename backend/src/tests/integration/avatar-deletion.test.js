/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Удаление учётной записи доводится до конца (нитка «Хвосты записи», Директива 3;
 * журнал решений CAT-D-3.1, слово Координатора 05.11.2026).
 *
 * Когда мы отвечаем человеку «удалено», его фото уходит из облака при любом сбое и
 * при выкатке, включая старые аватары; заведение узнаёт об отменённой брони.
 *
 * База настоящая, HTTP настоящий. Заглушено только облако, на уровне SDK: список и
 * удаление файла. Настоящий Cloudinary этот файл не зовёт: подмена https красит
 * любой выход в сеть из петли (`noNetwork`). Что заглушка не доказывает и что
 * проверяется вживую после выкатки: настоящий ответ списка и настоящее удаление.
 *
 * Запись задачи и уведомления ждут на уровне пула и клиента, как в
 * writes-before-answer.test.js: чтение после ответа такого не докажет.
 */

import https from 'https';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import pg from 'pg';
import request from 'supertest';
import app from '../../server.js';
import cloudinary from '../../config/cloudinary.js';
import { pool } from '../../config/database.js';
import * as avatarDeletionLoop from '../../services/avatarDeletionLoop.js';
import { anonymiseAccount, lockAccount } from '../../services/accountDeletionService.js';
import logger from '../../utils/logger.js';
import { clearAllData, getClient, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '..', '..', '..', 'migrations', '040_avatar_deletions.sql');

const WORD = 'УДАЛИТЬ';
const SILENCE_MS = 250;
const MAX_ATTEMPTS = 9;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const person = async () => {
  const email = `avatar-${randomUUID()}@test.com`;
  const created = await createUserAndGetTokens({
    email, password: 'Person123!@#', name: 'Иван Тестов', role: 'user', authMethod: 'email',
  });
  return { ...created, email, id: created.user.id };
};

const deleteAccount = (token) => request(app)
  .delete('/api/v1/auth/account')
  .set('Authorization', `Bearer ${token}`)
  .send({ confirmation: WORD });

const taskOf = async (userId) => (await query(
  `SELECT status, attempts, last_error, finished_at IS NOT NULL AS finished,
          EXTRACT(EPOCH FROM (next_attempt_at - NOW())) AS due_in
     FROM avatar_deletions WHERE user_id = $1`,
  [userId],
)).rows[0];

/** Пауза прошла: задача снова к сроку. */
const makeDue = (userId) => query(
  "UPDATE avatar_deletions SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE user_id = $1",
  [userId],
);

/** Выход в сеть из петли — провал теста: настоящего облака здесь быть не может. */
const noNetwork = () => jest.spyOn(https, 'request').mockImplementation(() => {
  throw new Error('в этом тесте сети нет');
});

const fakeCloud = (files) => {
  const left = new Set(files);
  const resources = jest.spyOn(cloudinary.api, 'resources').mockImplementation(async ({ resource_type: type, prefix }) => ({
    resources: type === 'image'
      ? [...left].filter((id) => id.startsWith(prefix)).sort().map((id) => ({ public_id: id }))
      : [],
  }));
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockImplementation(async (id) => (
    { result: left.delete(id) ? 'ok' : 'not found' }
  ));
  return { left, resources, destroy };
};

const brokenCloud = (message = 'Сломалось') => jest.spyOn(cloudinary.api, 'resources')
  .mockRejectedValue({ error: { message, http_code: 500 } });

const errorLines = () => jest.spyOn(logger, 'error').mockImplementation(() => logger);

/** Бронь впереди, день — литералом: текст уведомления сверяется буквально. */
const addBooking = async (establishmentId, userId, day = '2030-03-15') => (await query(
  `INSERT INTO bookings (
     establishment_id, user_id, booking_date, booking_time, guest_count,
     comment, contact_phone, status, expires_at
   )
   VALUES ($1, $2, $3::date, '19:00'::time, 2, 'Окно', '+375291112233', 'confirmed',
           (NOW() AT TIME ZONE 'UTC') + interval '2 hours')
   RETURNING id`,
  [establishmentId, userId, day],
)).rows[0].id;

const noticesTo = async (partnerId) => (await query(
  `SELECT message FROM notifications WHERE user_id = $1 AND type = 'booking_cancelled' ORDER BY message`,
  [partnerId],
)).rows.map((row) => row.message);

const realPoolQuery = pool.query.bind(pool);

/** Пропускает всё, кроме запросов `matches`: с ними поступает `onWrite`. */
const intercept = (matches, onWrite) => jest.spyOn(pool, 'query').mockImplementation((text, ...rest) => (
  typeof text === 'string' && matches(text)
    ? onWrite(() => realPoolQuery(text, ...rest))
    : realPoolQuery(text, ...rest)
));

const notificationInsert = (text) => text.includes('INSERT INTO notifications');

beforeEach(async () => {
  await clearAllData();
});

afterAll(async () => {
  await avatarDeletionLoop.stop();
  await clearAllData();
});

// ============================================================================
// Задача пишется вместе с удалением
// ============================================================================

describe('задача на удаление папки пишется в транзакции удаления', () => {
  test('ответ прежний, задача на месте, облако ответа не ждёт и не зовётся', async () => {
    const network = noNetwork();
    const { resources, destroy } = fakeCloud([]);
    const p = await person();
    await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [
      p.id, `https://res.cloudinary.com/test/image/upload/v1/avatars/${p.id}/face.jpg`,
    ]);

    const response = await deleteAccount(p.accessToken).expect(200);

    expect(response.body).toEqual({ success: true, data: { deleted: true } });
    expect(await taskOf(p.id)).toMatchObject({ status: 'pending', attempts: 0, last_error: null, finished: false });
    expect(resources).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  test.each([
    ['снял фото: ссылки нет, в папке могут лежать старые', null],
    ['перешёл на фото из Google: в папке могут лежать старые', 'https://lh3.googleusercontent.com/a/face'],
  ])('%s — задача всё равно пишется', async (_name, avatarUrl) => {
    fakeCloud([]);
    const p = await person();
    await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [p.id, avatarUrl]);

    await deleteAccount(p.accessToken).expect(200);

    expect(await taskOf(p.id)).toMatchObject({ status: 'pending' });
  });

  test('отказ транзакции удаления после записи задачи: задачи нет, учётная запись цела', async () => {
    const realClientQuery = pg.Client.prototype.query;
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const p = await person();

    // Запись журнала о самом удалении идёт после задачи и падает: откатывается всё.
    jest.spyOn(pg.Client.prototype, 'query').mockImplementation(function failJournal(text, values, ...rest) {
      if (Array.isArray(values) && values.includes('user_delete_account') && String(text?.text ?? text).includes('INSERT INTO audit_log')) {
        return Promise.reject(new Error('journal failed'));
      }
      return realClientQuery.call(this, text, values, ...rest);
    });
    await deleteAccount(p.accessToken).expect(500);
    pg.Client.prototype.query.mockRestore();

    expect(await taskOf(p.id)).toBeUndefined();
    const { rows } = await query('SELECT is_active, email FROM users WHERE id = $1', [p.id]);
    expect(rows[0]).toEqual({ is_active: true, email: p.email });
  });

  test('транзакция откатилась у вызывающего: задачи нет', async () => {
    const p = await person();
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const account = await lockAccount(client, p.id);
      await anonymiseAccount(client, account, { userId: p.id, queueAvatarDeletion: true });
      expect((await client.query('SELECT count(*)::int AS n FROM avatar_deletions WHERE user_id = $1', [p.id])).rows[0].n).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await taskOf(p.id)).toBeUndefined();
  });

  test('владельцу карточки отказано: задачи нет', async () => {
    const { partner } = await createPartnerWithEstablishment('active');

    await deleteAccount(partner.accessToken).expect(409);

    expect(await taskOf(partner.user.id)).toBeUndefined();
  });

  test('повтор записи задачи не задваивает её', async () => {
    const p = await person();
    await query('INSERT INTO avatar_deletions (user_id, status) VALUES ($1, $2)', [p.id, 'done']);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const account = await lockAccount(client, p.id);
      await anonymiseAccount(client, account, { userId: p.id, queueAvatarDeletion: true });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await taskOf(p.id)).toMatchObject({ status: 'done' });
  });
});

// ============================================================================
// Петля
// ============================================================================

describe('петля доводит задачу до конца', () => {
  test('успех: файлы текущего и старого аватара удалены, чужие целы, задача закрыта', async () => {
    const network = noNetwork();
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    const current = `avatars/${p.id}/current`;
    const old = `avatars/${p.id}/old`;
    const neighbour = `avatars/${p.id}0/face`;
    const stranger = `avatars/${randomUUID()}/face`;
    const { left, destroy } = fakeCloud([current, old, neighbour, stranger]);

    await avatarDeletionLoop.tick();

    expect([...left].sort()).toEqual([neighbour, stranger].sort());
    expect(destroy.mock.calls).toEqual([
      [current, { invalidate: true, resource_type: 'image' }],
      [old, { invalidate: true, resource_type: 'image' }],
    ]);
    expect(await taskOf(p.id)).toMatchObject({ status: 'done', attempts: 0, last_error: null, finished: true });
    expect(network).not.toHaveBeenCalled();
  });

  test('закрытая задача не повторяется: второй проход облако не зовёт', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    const { resources } = fakeCloud([]);
    await avatarDeletionLoop.tick();
    const callsAfterFirst = resources.mock.calls.length;
    await makeDue(p.id);

    await avatarDeletionLoop.tick();

    expect(callsAfterFirst).toBe(3);
    expect(resources).toHaveBeenCalledTimes(3);
  });

  test('один проход — один человек: так петля держит лимит в час', async () => {
    const first = await person();
    const second = await person();
    await deleteAccount(first.accessToken).expect(200);
    await deleteAccount(second.accessToken).expect(200);
    const { resources } = fakeCloud([]);

    await avatarDeletionLoop.tick();

    expect(resources).toHaveBeenCalledTimes(3);
    const statuses = [(await taskOf(first.id)).status, (await taskOf(second.id)).status];
    expect(statuses.sort()).toEqual(['done', 'pending']);
  });

  test('сбой облака: задача жива, ждёт паузу, не берётся раньше и после паузы закрывается', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    const warnings = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    brokenCloud('Сломалось');

    await avatarDeletionLoop.tick();

    const failed = await taskOf(p.id);
    expect(failed).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'Avatar folder listing failed: Сломалось',
      finished: false,
    });
    // Первая пауза — пять минут: не сразу и не через час.
    expect(Number(failed.due_in)).toBeGreaterThan(290);
    expect(Number(failed.due_in)).toBeLessThanOrEqual(300);
    expect(warnings).toHaveBeenCalledWith(
      'Avatar deletion: attempt failed, will try again',
      expect.objectContaining({ userId: p.id, attempts: 1, pauseMs: 300000 }),
    );

    // Пауза не прошла: облако не зовётся.
    cloudinary.api.resources.mockClear();
    await avatarDeletionLoop.tick();
    expect(cloudinary.api.resources).not.toHaveBeenCalled();

    // Пауза прошла, облако ожило: файл ушёл, задача закрыта.
    cloudinary.api.resources.mockRestore();
    await makeDue(p.id);
    const { left } = fakeCloud([`avatars/${p.id}/face`]);
    await avatarDeletionLoop.tick();

    expect(left.size).toBe(0);
    expect(await taskOf(p.id)).toMatchObject({ status: 'done', attempts: 1, last_error: null, finished: true });
  });

  test('предел попыток: запись осталась, ошибка в журнале, больше не берётся; снимается одной строкой', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const errors = errorLines();
    brokenCloud('Ключ не подходит');

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await makeDue(p.id);
      await avatarDeletionLoop.tick();
      expect((await taskOf(p.id)).attempts).toBe(attempt);
    }

    expect(await taskOf(p.id)).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      last_error: 'Avatar folder listing failed: Ключ не подходит',
      finished: true,
    });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      'Avatar deletion: attempts ran out, the files stay on the cloud',
      { userId: p.id, attempts: MAX_ATTEMPTS, error: 'Avatar folder listing failed: Ключ не подходит' },
    );

    cloudinary.api.resources.mockClear();
    await makeDue(p.id);
    await avatarDeletionLoop.tick();
    expect(cloudinary.api.resources).not.toHaveBeenCalled();
    expect((await taskOf(p.id)).status).toBe('failed');

    // Строка из шапки миграции: задача снова идёт.
    await query(`UPDATE avatar_deletions SET status = 'pending', attempts = 0, next_attempt_at = NOW() WHERE status = 'failed'`);
    cloudinary.api.resources.mockRestore();
    fakeCloud([]);
    await avatarDeletionLoop.tick();
    expect((await taskOf(p.id)).status).toBe('done');
  });

  test('перезапуск между COMMIT и обработкой: новый процесс берёт задачу из таблицы', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    await avatarDeletionLoop.stop();

    // Новая копия модуля, как в новом процессе: память прежней ни при чём.
    const restarted = await import('../../services/avatarDeletionLoop.js?restart=1');
    expect(restarted.tick).not.toBe(avatarDeletionLoop.tick);
    const { left } = fakeCloud([`avatars/${p.id}/face`]);

    await restarted.tick();

    expect(left.size).toBe(0);
    expect(await taskOf(p.id)).toMatchObject({ status: 'done', attempts: 0 });
  });

  test('процесс умер посреди задачи: попытка не списана, задача вернётся после срока занятости', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    // Как умер: задача взята и больше ничего.
    await query(
      `UPDATE avatar_deletions SET next_attempt_at = NOW() + INTERVAL '10 minutes' WHERE user_id = $1`,
      [p.id],
    );
    const { left, resources } = fakeCloud([`avatars/${p.id}/face`]);

    // Срок занятости не вышел: живой сосед мог бы ещё работать.
    await avatarDeletionLoop.tick();
    expect(resources).not.toHaveBeenCalled();

    await makeDue(p.id);
    await avatarDeletionLoop.tick();

    expect(left.size).toBe(0);
    expect(await taskOf(p.id)).toMatchObject({ status: 'done', attempts: 0 });
  });

  test('взятие задачи отодвигает её на 10 минут: второй процесс её не возьмёт', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let markReached;
    const reached = new Promise((resolve) => { markReached = resolve; });
    jest.spyOn(cloudinary.api, 'resources').mockImplementation(async () => {
      markReached();
      await hold;
      return { resources: [] };
    });

    const working = avatarDeletionLoop.tick();
    await reached;

    const during = await taskOf(p.id);
    expect(Number(during.due_in)).toBeGreaterThan(590);
    expect(Number(during.due_in)).toBeLessThanOrEqual(600);
    const other = await import('../../services/avatarDeletionLoop.js?restart=2');
    const callsBefore = cloudinary.api.resources.mock.calls.length;
    await other.tick();
    expect(cloudinary.api.resources.mock.calls.length).toBe(callsBefore);

    release();
    await working;
    expect((await taskOf(p.id)).status).toBe('done');
  });

  test('stop посреди задачи: дожидается текущего вызова, следующего не делает, попытка не списана', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let markReached;
    const reached = new Promise((resolve) => { markReached = resolve; });
    jest.spyOn(cloudinary.api, 'resources').mockImplementation(async () => {
      markReached();
      await hold;
      return { resources: [{ public_id: `avatars/${p.id}/face` }] };
    });
    const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    const working = avatarDeletionLoop.tick();
    await reached;
    let stopped = false;
    const stopping = avatarDeletionLoop.stop().then(() => { stopped = true; });
    await sleep(50);
    expect(stopped).toBe(false);

    release();
    await stopping;
    await working;

    expect(destroy).not.toHaveBeenCalled();
    expect(await taskOf(p.id)).toMatchObject({ status: 'pending', attempts: 0, last_error: null });
  });

  test('цифры ключа в отказе облака не доходят ни до таблицы, ни до журнала', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    const warnings = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    brokenCloud('Unknown API key 123456789012345');

    await avatarDeletionLoop.tick();

    const { last_error: lastError } = await taskOf(p.id);
    expect(lastError).toBe('Avatar folder listing failed: Unknown API key [digits hidden]');
    expect(JSON.stringify(warnings.mock.calls)).not.toContain('123456789012345');
  });

  test('длинный текст отказа укорочен: таблица не копит чужие простыни', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    brokenCloud('x'.repeat(5000));

    await avatarDeletionLoop.tick();

    expect((await taskOf(p.id)).last_error).toHaveLength(300);
  });

  test('сбой базы: проход не падает, строка в журнале, задача на месте', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    const errors = errorLines();
    const { resources } = fakeCloud([]);
    intercept((text) => text.includes('UPDATE avatar_deletions'), async () => {
      throw new Error('база недоступна');
    });

    await expect(avatarDeletionLoop.tick()).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledWith('Avatar deletion: tick failed', { error: 'база недоступна' });
    expect(resources).not.toHaveBeenCalled();
    expect((await taskOf(p.id)).status).toBe('pending');
  });

  test('раз в час петля говорит, что жива, и сколько задач открыто', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);
    const failedPerson = await person();
    await query(`INSERT INTO avatar_deletions (user_id, status) VALUES ($1, 'failed')`, [failedPerson.id]);
    fakeCloud([]);
    const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    const fresh = await import('../../services/avatarDeletionLoop.js?restart=3');

    await fresh.tick();

    expect(info).toHaveBeenCalledWith('Avatar deletion: loop alive', { pending: 1, failed: 1 });
    info.mockClear();
    await fresh.tick();
    expect(info).not.toHaveBeenCalledWith('Avatar deletion: loop alive', expect.anything());
  });
});

// ============================================================================
// Окно «код раньше миграции»
// ============================================================================

describe('схема без таблицы: окно между выкаткой и миграцией 040', () => {
  // Таблицу снимает сам тест и возвращает в `finally`. Убитый между ними прогон
  // оставит её снятой, и следующий упадёт на общем TRUNCATE (testTables.js): вернуть
  // можно, применив backend/migrations/040_avatar_deletions.sql. Изолированный раннер
  // (scripts/test-isolated) собирает свою базу заново.
  test('удаление проходит, ответ тот же; текущий файл удаляется прежним путём; петля молчит', async () => {
    const p = await person();
    await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [
      p.id, `https://res.cloudinary.com/test/image/upload/v1/avatars/${p.id}/face0001.jpg`,
    ]);
    const { partner, establishment } = await createPartnerWithEstablishment('active');
    await addBooking(establishment.id, p.id);
    const { destroy, resources } = fakeCloud([`avatars/${p.id}/face0001`]);
    const errors = errorLines();
    const warnings = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    await query('DROP TABLE avatar_deletions');
    try {
      const response = await deleteAccount(p.accessToken).expect(200);

      expect(response.body).toEqual({ success: true, data: { deleted: true } });
      const { rows } = await query('SELECT is_active, avatar_url, email FROM users WHERE id = $1', [p.id]);
      expect(rows[0]).toEqual({ is_active: false, avatar_url: null, email: null });
      expect(destroy.mock.calls).toEqual([[`avatars/${p.id}/face0001`, { invalidate: true }]]);
      expect(await noticesTo(partner.user.id)).toEqual(['Бронь на «Test Establishment» (15 марта 19:00) отменена гостем']);

      // Журнал запроса тут ни при чём (в тестах лимитер пишет про Redis): молчит петля.
      errors.mockClear();
      warnings.mockClear();
      await avatarDeletionLoop.tick();

      expect(resources).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
    } finally {
      await query(readFileSync(MIGRATION, 'utf8'));
    }
  });
});

// ============================================================================
// Уведомления заведениям об отменённых бронях
// ============================================================================

describe('уведомление заведению об отменённой брони', () => {
  const twoBookings = async () => {
    const p = await person();
    const { partner, establishment } = await createPartnerWithEstablishment('active');
    await addBooking(establishment.id, p.id, '2030-03-15');
    await addBooking(establishment.id, p.id, '2030-03-16');
    return { p, partner };
  };

  const TEXTS = [
    'Бронь на «Test Establishment» (15 марта 19:00) отменена гостем',
    'Бронь на «Test Establishment» (16 марта 19:00) отменена гостем',
  ];

  test('ответ не уходит, пока уведомление не записано', async () => {
    const { p } = await twoBookings();
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    let markReached;
    const reached = new Promise((resolve) => { markReached = resolve; });
    intercept(notificationInsert, async (write) => {
      markReached();
      await released;
      return write();
    });

    let answered = false;
    const pending = deleteAccount(p.accessToken).then((response) => {
      answered = true;
      return response;
    });
    try {
      await Promise.race([reached, pending]);
      await sleep(SILENCE_MS);
      expect(answered).toBe(false);
    } finally {
      release();
    }

    expect((await pending).status).toBe(200);
  });

  test('к ответу записано всё: по одному на бронь, без задвоения', async () => {
    const { p, partner } = await twoBookings();

    await deleteAccount(p.accessToken).expect(200);

    expect(await noticesTo(partner.user.id)).toEqual(TEXTS);
  });

  test('сбой записи одного уведомления не откатывает удаление, остальные доходят, ошибка в журнале', async () => {
    const { p, partner } = await twoBookings();
    const errors = errorLines();
    let failed = false;
    intercept(notificationInsert, async (write) => {
      if (!failed) {
        failed = true;
        throw new Error('запись упала');
      }
      return write();
    });

    const response = await deleteAccount(p.accessToken).expect(200);

    expect(response.body).toEqual({ success: true, data: { deleted: true } });
    const { rows } = await query('SELECT is_active FROM users WHERE id = $1', [p.id]);
    expect(rows[0].is_active).toBe(false);
    expect(await noticesTo(partner.user.id)).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      'Failed to create booking cancelled notification',
      expect.objectContaining({ error: 'запись упала' }),
    );
  });

  test('откат транзакции удаления: уведомления нет', async () => {
    const { p, partner } = await twoBookings();
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const realClientQuery = pg.Client.prototype.query;
    jest.spyOn(pg.Client.prototype, 'query').mockImplementation(function failJournal(text, values, ...rest) {
      if (Array.isArray(values) && values.includes('user_delete_account') && String(text?.text ?? text).includes('INSERT INTO audit_log')) {
        return Promise.reject(new Error('journal failed'));
      }
      return realClientQuery.call(this, text, values, ...rest);
    });

    await deleteAccount(p.accessToken).expect(500);
    pg.Client.prototype.query.mockRestore();

    expect(await noticesTo(partner.user.id)).toEqual([]);
  });
});
