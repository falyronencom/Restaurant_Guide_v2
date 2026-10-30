/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Удаление учётки самим человеком (бриф В1, 18.10.2026: App Store 5.1.1(v),
 * Google Play, закон 99-З).
 *
 * Удаление — обезличивание, не DELETE строки users (обзор 23.09, п. 36):
 * строка остаётся пустой оболочкой, отключённой и без единого признака
 * человека. Решения Координатора (18.10, «да по рекомендации»):
 *   1. отзывы остаются, автор — «Гость», без фото;
 *   2. в бронях у заведения остаются дата, время и число гостей, имя и
 *      телефон стираются;
 *   3. владелец карточек не удаляется, пока карточки не переданы, —
 *      «напишите в поддержку»;
 *   4. подтверждение — словом УДАЛИТЬ.
 *
 * Ожидаемые значения — из брифа и решений, не из кода: «Гость», УДАЛИТЬ,
 * пустой телефон брони, тексты отказов — литералами.
 *
 * На старом коде (до В1) каждый тест здесь красный: маршрутов
 * GET /auth/account/deletion и DELETE /auth/account не было (404), а панель
 * разблокировала удалённую учётку как любую отключённую (200).
 */

import { randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { v2 as cloudinarySdk } from 'cloudinary';
import app from '../../server.js';
import { generateTokenPair } from '../../services/authService.js';
import { anonymiseAccount, lockAccount } from '../../services/accountDeletionService.js';
import { clearAllData, query, getClient } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createViewerAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
} from '../utils/adminTestHelpers.js';
import { oauthProviderResponses } from '../fixtures/users.js';

const AUTH = '/api/v1/auth';
const PASSWORD = 'Person123!@#';
const WORD = 'УДАЛИТЬ';

const OWNS_CARDS_TEXT = 'У вас есть карточки заведений. Удалить учётную запись можно, когда их передадут '
  + 'другому владельцу, — напишите в поддержку: support@nirivio.by';

/** Человек, вошедший по паролю: с живыми токенами, как из приложения. */
const person = async ({ name = 'Иван Тестов', phone = null } = {}) => {
  const email = `person-${randomUUID()}@test.com`;
  const created = await createUserAndGetTokens({
    email, phone, password: PASSWORD, name, role: 'user', authMethod: 'email',
  });
  return { ...created, email, id: created.user.id };
};

const deleteAccount = (token, body = { confirmation: WORD }) => request(app)
  .delete(`${AUTH}/account`)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

const deletionCheck = (token) => request(app)
  .get(`${AUTH}/account/deletion`)
  .set('Authorization', `Bearer ${token}`);

const userRow = async (id) => (await query(
  `SELECT email, phone, password_hash, oauth_provider_id, name, avatar_url,
          email_verified, phone_verified, last_login_at, is_active, role, auth_method
   FROM users WHERE id = $1`,
  [id],
)).rows[0];

const count = async (sql, params) => (await query(sql, params)).rows[0].n;

const deletionEntries = async (userId) => (await query(
  `SELECT user_id, old_data, new_data, ip_address, user_agent FROM audit_log
   WHERE entity_type = 'user' AND entity_id = $1 AND action = 'user_delete_account'`,
  [userId],
)).rows;

/** Карточка ещё одного партнёра (или того же) напрямую в базе. */
const addCard = async (partnerId, status, { published = false } = {}) => {
  const id = randomUUID();
  const { rows } = await query(
    `INSERT INTO establishments (
       id, partner_id, name, slug, description, city, address,
       latitude, longitude, categories, cuisines, price_range,
       working_hours, status, published_at, created_at, updated_at
     )
     VALUES ($1, $2, 'Карточка', $3, 'Описание', 'Минск', 'ул. Тестовая 2',
             53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$',
             '{"monday":{"open":"10:00","close":"22:00"}}'::jsonb, $4,
             CASE WHEN $5 THEN NOW() ELSE NULL END, NOW(), NOW())
     RETURNING *`,
    [id, partnerId, `card-${id.slice(0, 8)}`, status, published],
  );
  return rows[0];
};

/**
 * Бронь напрямую в базе. День — по минскому календарю от сегодня; срок
 * ожидания — наивное UTC-время, как его пишет bookingModel.create.
 */
const addBooking = async (establishmentId, userId, {
  status = 'confirmed', dayOffset = 2, time = '19:00', comment = 'Столик у окна, Иван',
  expiresInHours = 2,
} = {}) => {
  const { rows } = await query(
    `INSERT INTO bookings (
       establishment_id, user_id, booking_date, booking_time, guest_count,
       comment, contact_phone, status, expires_at
     )
     VALUES ($1, $2, (NOW() AT TIME ZONE 'Europe/Minsk')::date + $3::int, $4::time, 3,
             $5, '+375291112233', $6,
             (NOW() AT TIME ZONE 'UTC') + make_interval(hours => $7::int))
     RETURNING id`,
    [establishmentId, userId, dayOffset, time, comment, status, expiresInHours],
  );
  return rows[0].id;
};

/**
 * Бронь на момент, заданный SQL-выражениями дня и времени. Выражения —
 * фиксированные строки теста, не ввод: литеральный день ('2030-03-15') или
 * минское «сейчас минус час».
 */
const addBookingAt = async (establishmentId, userId, status, dateSql, timeSql) => {
  const { rows } = await query(
    `INSERT INTO bookings (
       establishment_id, user_id, booking_date, booking_time, guest_count,
       comment, contact_phone, status, expires_at
     )
     VALUES ($1, $2, ${dateSql}, ${timeSql}, 2, 'Окно', '+375291112233', $3,
             (NOW() AT TIME ZONE 'UTC') + interval '2 hours')
     RETURNING id`,
    [establishmentId, userId, status],
  );
  return rows[0].id;
};

const MINSK_HOUR_AGO = "((NOW() AT TIME ZONE 'Europe/Minsk') - interval '1 hour')";

const bookingRow = async (id) => (await query(
  'SELECT status, contact_phone, comment, guest_count, booking_date, booking_time, cancelled_at FROM bookings WHERE id = $1',
  [id],
)).rows[0];

/** Дождаться записи, которую сервер делает после ответа (уведомления). */
const eventually = async (read, accept) => {
  let value;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  return value;
};

/**
 * Ждать, пока чей-то запрос встанет в очередь за блокировкой строки: так тест
 * знает, что гонка разыграна, а не угадывает паузой.
 */
const waitForLockWaiters = async (expected) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n >= expected) return;
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error(`в очереди за блокировкой нет ${expected} запросов`);
};

let savedFetch;

beforeAll(() => {
  savedFetch = global.fetch;
});

beforeEach(async () => {
  await clearAllData();
});

afterEach(() => {
  global.fetch = savedFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Подтверждение — решение 4
// ============================================================================

describe('DELETE /auth/account — подтверждение словом УДАЛИТЬ', () => {
  test.each([
    ['без тела', (call) => call],
    ['без слова', (call) => call.send({})],
    ['другим словом', (call) => call.send({ confirmation: 'удали' })],
    ['словом не той строкой', (call) => call.send({ confirmation: ['УДАЛИТЬ'] })],
  ])('%s — 422, учётка на месте', async (_, withBody) => {
    const p = await person();

    const response = await withBody(
      request(app).delete(`${AUTH}/account`).set('Authorization', `Bearer ${p.accessToken}`),
    ).expect(422);

    expect(response.body.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(response.body.message).toBe('Чтобы удалить учётную запись, введите слово УДАЛИТЬ');
    const row = await userRow(p.id);
    expect(row).toMatchObject({ email: p.email, name: 'Иван Тестов', is_active: true });
    expect(await deletionEntries(p.id)).toHaveLength(0);
  });

  test('слово принимается без учёта регистра и пробелов по краям', async () => {
    const p = await person();

    await deleteAccount(p.accessToken, { confirmation: '  удалить ' }).expect(200);

    expect((await userRow(p.id)).is_active).toBe(false);
  });
});

// ============================================================================
// Что исчезает
// ============================================================================

describe('DELETE /auth/account — что исчезает', () => {
  test('строка учётки: ни почты, ни телефона, ни пароля, ни сервиса входа; имя «Гость», без фото; отключена', async () => {
    const p = await person({ phone: '+375291234567' });
    await query(
      `UPDATE users SET avatar_url = 'https://lh3.googleusercontent.com/a/face', email_verified = TRUE,
              phone_verified = TRUE, last_login_at = NOW()
       WHERE id = $1`,
      [p.id],
    );

    const response = await deleteAccount(p.accessToken).expect(200);

    expect(response.body).toEqual({ success: true, data: { deleted: true } });
    expect(await userRow(p.id)).toEqual({
      email: null,
      phone: null,
      password_hash: null,
      oauth_provider_id: null,
      name: 'Гость',
      avatar_url: null,
      email_verified: false,
      phone_verified: false,
      last_login_at: null,
      is_active: false,
      // Остаются: роль и способ входа — не признаки человека.
      role: 'user',
      auth_method: 'email',
    });
    // Выданные сеансы погашены и отметкой (миграция 035): токен до неё не
    // примут, даже если учётку когда-нибудь включат.
    const stamp = await query('SELECT sessions_revoked_at FROM users WHERE id = $1', [p.id]);
    expect(stamp.rows[0].sessions_revoked_at).not.toBeNull();
  });

  test('избранное удалено, счётчик карточки уменьшился', async () => {
    const p = await person();
    const other = await person({ name: 'Другой Гость' });
    const { establishment } = await createPartnerWithEstablishment('active');
    await query(
      'INSERT INTO favorites (user_id, establishment_id) VALUES ($1, $3), ($2, $3)',
      [p.id, other.id, establishment.id],
    );
    await query('UPDATE establishments SET favorite_count = 2 WHERE id = $1', [establishment.id]);

    await deleteAccount(p.accessToken).expect(200);

    expect(await count('SELECT COUNT(*)::int AS n FROM favorites WHERE user_id = $1', [p.id])).toBe(0);
    expect(await count('SELECT COUNT(*)::int AS n FROM favorites WHERE user_id = $1', [other.id])).toBe(1);
    expect((await query('SELECT favorite_count FROM establishments WHERE id = $1', [establishment.id])).rows[0].favorite_count).toBe(1);
  });

  test('уведомления, их настройки, адреса устройств, коды подтверждения и ссылки сброса удалены', async () => {
    const p = await person();
    await query(
      `INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'review_moderated', 'Отзыв', 'Текст')`,
      [p.id],
    );
    await query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [p.id]);
    await query(
      `INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, 'fcm-token-of-person', 'android')`,
      [p.id],
    );
    await query(
      `INSERT INTO email_verification_codes (user_id, code, expires_at) VALUES ($1, '123456', NOW() + interval '1 hour')`,
      [p.id],
    );
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + interval '30 minutes')`,
      [p.id, 'f'.repeat(64)],
    );

    await deleteAccount(p.accessToken).expect(200);

    for (const table of [
      'notifications', 'notification_preferences', 'device_tokens',
      'email_verification_codes', 'password_reset_tokens', 'refresh_tokens',
    ]) {
      expect([table, await count(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`, [p.id])])
        .toEqual([table, 0]);
    }
  });

  test('журнал: одна запись user_delete_account от самого человека — без почты, телефона и адреса запроса', async () => {
    const p = await person({ phone: '+375297654321' });

    await deleteAccount(p.accessToken).expect(200);

    const entries = await deletionEntries(p.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: p.id,
      old_data: { role: 'user', auth_method: 'email' },
      new_data: { reviews_kept: 0, bookings_cancelled: 0, favorites_removed: 0, drafts_deleted: 0 },
      ip_address: null,
      user_agent: null,
    });
    // Только счётчики: автор удаления самим человеком — user_id; скрипт
    // оператора называет себя в new_data.actor (delete-account-script.test.js).
    expect(entries[0].new_data).toEqual({
      reviews_kept: 0,
      bookings_cancelled: 0,
      favorites_removed: 0,
      drafts_deleted: 0,
      access_tokens_revoked: true,
    });
    const written = JSON.stringify(entries[0]);
    expect(written).not.toContain(p.email);
    expect(written).not.toContain('297654321');
    expect(written).not.toContain('Иван');
  });
});

// ============================================================================
// Войти в ту же запись нельзя
// ============================================================================

describe('DELETE /auth/account — войти в ту же запись нельзя', () => {
  test('вход прежним паролем — 401, как неверный пароль', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);

    const response = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: p.email, password: PASSWORD })
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('прежний access-токен и прежний refresh-токен — 401', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);

    await request(app).get(`${AUTH}/me`).set('Authorization', `Bearer ${p.accessToken}`).expect(401);
    await request(app).post(`${AUTH}/refresh`).send({ refreshToken: p.refreshToken }).expect(401);
  });

  test('сеанс, выданный записи в гонке с удалением, не открывает её: учётка отключена', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);

    // Вход, нашедший запись до удаления, выдаёт токены уже после него.
    const late = await generateTokenPair({ id: p.id, role: 'user', email: p.email });

    const me = await request(app).get(`${AUTH}/me`).set('Authorization', `Bearer ${late.accessToken}`).expect(401);
    expect(me.body.error.code).toBe('ACCOUNT_INACTIVE');
    await request(app).post(`${AUTH}/refresh`).send({ refreshToken: late.refreshToken }).expect(401);
  });

  test('вход через Яндекс тем же человеком открывает НОВУЮ учётку, удалённая остаётся пустой', async () => {
    const yandex = oauthProviderResponses.yandex;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => yandex });

    const first = await request(app).post(`${AUTH}/oauth`)
      .send({ provider: 'yandex', token: 'oauth-token-1234567890' }).expect(200);
    const firstId = first.body.data.user.id;
    await deleteAccount(first.body.data.accessToken).expect(200);

    const second = await request(app).post(`${AUTH}/oauth`)
      .send({ provider: 'yandex', token: 'oauth-token-1234567890' }).expect(200);

    expect(second.body.data.user.id).not.toBe(firstId);
    expect(second.body.data.user.email).toBe(yandex.default_email);
    expect(await userRow(firstId)).toMatchObject({
      email: null, oauth_provider_id: null, name: 'Гость', is_active: false,
    });
  });

  test('регистрация на ту же почту — новая учётка', async () => {
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);

    const response = await request(app).post(`${AUTH}/register`)
      .send({ email: p.email, password: PASSWORD, name: 'Иван Снова', authMethod: 'email' })
      .expect(201);

    expect(response.body.data.user.id).not.toBe(p.id);
  });
});

// ============================================================================
// Что остаётся обезличенным — решения 1 и 2
// ============================================================================

describe('DELETE /auth/account — что остаётся без имени', () => {
  test('отзыв на месте с оценкой и текстом; автор «Гость» без фото; рейтинг заведения не сдвинулся', async () => {
    const p = await person();
    await query(`UPDATE users SET avatar_url = 'https://lh3.googleusercontent.com/a/face' WHERE id = $1`, [p.id]);
    const { establishment } = await createPartnerWithEstablishment('active');
    await createTestReview(p.id, establishment.id, { rating: 2, content: 'Холодный суп и долгое ожидание' });
    await createTestReview(null, establishment.id, { rating: 5, content: 'Отличное место' });
    const before = (await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1', [establishment.id],
    )).rows[0];

    await deleteAccount(p.accessToken).expect(200);

    const { body } = await request(app).get(`/api/v1/establishments/${establishment.id}/reviews`).expect(200);
    const kept = body.data.reviews.find((review) => review.content === 'Холодный суп и долгое ожидание');
    expect(kept).toMatchObject({ rating: 2, author: { id: null, name: 'Гость', avatar_url: null } });
    expect(body.data.reviews).toHaveLength(2);
    const after = (await query(
      'SELECT average_rating, review_count FROM establishments WHERE id = $1', [establishment.id],
    )).rows[0];
    expect(after).toEqual(before);
    expect((await deletionEntries(p.id))[0].new_data.reviews_kept).toBe(1);
  });

  test('по отзыву удалённого человека не найти его другие: id автора нет ни в списке, ни в отзыве, его список — 404', async () => {
    // Кто видел отзыв с именем до удаления, знает и id автора: с ним
    // GET /users/:id/reviews собрал бы все отзывы человека и после
    // удаления (Phase 3.5, линза, 18.10). Автор другого отзыва — на месте.
    const p = await person();
    const other = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const own = await createTestReview(p.id, establishment.id, { rating: 3, content: 'Шумно, но вкусно' });
    await createTestReview(other.id, establishment.id, { rating: 5, content: 'Отличное место' });
    await request(app).get(`/api/v1/users/${p.id}/reviews`).expect(200);

    await deleteAccount(p.accessToken).expect(200);

    const list = await request(app).get(`/api/v1/establishments/${establishment.id}/reviews`).expect(200);
    const authors = Object.fromEntries(list.body.data.reviews.map((review) => [review.content, review.author.id]));
    expect(authors).toEqual({ 'Шумно, но вкусно': null, 'Отличное место': other.id });
    const single = await request(app).get(`/api/v1/reviews/${own.id}`).expect(200);
    expect(single.body.data.review.author).toEqual({ id: null, name: 'Гость', avatar_url: null });
    const byAuthor = await request(app).get(`/api/v1/users/${p.id}/reviews`).expect(404);
    expect(byAuthor.body.error.code).toBe('USER_NOT_FOUND');
    await request(app).get(`/api/v1/users/${other.id}/reviews`).expect(200);
  });

  test('брони: у заведения дата, время и гости — без имени, телефона и комментария; предстоящие отменены и заведению сказано', async () => {
    const p = await person({ phone: '+375291234567' });
    const { partner, establishment } = await createPartnerWithEstablishment('active');
    // Дни — литералами: день в уведомлении сверяется буквально.
    const ahead = await addBookingAt(establishment.id, p.id, 'confirmed', "'2030-03-15'::date", "'19:00'::time");
    const waiting = await addBookingAt(establishment.id, p.id, 'pending', "'2030-03-16'::date", "'20:30'::time");
    const done = await addBooking(establishment.id, p.id, { status: 'completed', dayOffset: -5 });
    const lapsed = await addBooking(establishment.id, p.id, {
      status: 'pending', dayOffset: 1, expiresInHours: -1,
    });
    // Подтверждённые, чей час уже прошёл: давно и час назад по Минску. Час
    // назад по Минску — это ещё два часа вперёд, если прочесть время как UTC.
    const pastConfirmed = await addBookingAt(establishment.id, p.id, 'confirmed', "'2020-03-15'::date", "'19:00'::time");
    const hourAgo = await addBookingAt(
      establishment.id, p.id, 'confirmed', `${MINSK_HOUR_AGO}::date`, `${MINSK_HOUR_AGO}::time`,
    );

    await deleteAccount(p.accessToken).expect(200);

    expect(await bookingRow(ahead)).toMatchObject({
      status: 'cancelled', contact_phone: '', comment: null, guest_count: 2,
    });
    expect((await bookingRow(ahead)).cancelled_at).not.toBeNull();
    expect(await bookingRow(waiting)).toMatchObject({ status: 'cancelled', contact_phone: '', comment: null });
    // Прошедшая — в прежнем статусе, но тоже без телефона и комментария.
    expect(await bookingRow(done)).toMatchObject({ status: 'completed', contact_phone: '', comment: null, guest_count: 3 });
    // Просроченную ожидающую отменять не за чем: её закроет ленивое истечение.
    expect(await bookingRow(lapsed)).toMatchObject({ status: 'pending', contact_phone: '' });
    // Подтверждённые, чей час прошёл, остаются заведению отметить «пришёл» или
    // «не пришёл».
    expect(await bookingRow(pastConfirmed)).toMatchObject({ status: 'confirmed', contact_phone: '', comment: null });
    expect(await bookingRow(hourAgo)).toMatchObject({ status: 'confirmed', contact_phone: '', comment: null });

    const { body } = await request(app)
      .get(`/api/v1/partner/bookings/${establishment.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(200);
    const seen = body.data.items.find((item) => item.id === done);
    expect(seen).toMatchObject({
      user_name: 'Гость', user_phone: null, contact_phone: '', comment: null, guest_count: 3, status: 'completed',
    });
    expect(seen.booking_time).toBe('19:00:00');

    const notices = await eventually(
      () => query(
        `SELECT message FROM notifications WHERE user_id = $1 AND type = 'booking_cancelled' ORDER BY message`,
        [partner.user.id],
      ),
      (result) => result.rows.length >= 2,
    );
    expect(notices.rows.map((notice) => notice.message)).toEqual([
      'Бронь на «Test Establishment» (15 марта 19:00) отменена гостем',
      'Бронь на «Test Establishment» (16 марта 20:30) отменена гостем',
    ]);
    expect((await deletionEntries(p.id))[0].new_data.bookings_cancelled).toBe(2);
  });
});

// ============================================================================
// Кого не удаляют — решение 3 и учётки оператора
// ============================================================================

describe('DELETE /auth/account — владельца карточек и учётки оператора не удаляют', () => {
  test.each(['active', 'pending', 'suspended', 'archived'])(
    'владелец карточки в статусе %s — 409 «напишите в поддержку», ничего не тронуто',
    async (status) => {
      const { partner, establishment } = await createPartnerWithEstablishment(status);

      const check = await deletionCheck(partner.accessToken).expect(200);
      expect(check.body.data).toEqual({
        allowed: false,
        refusal: { code: 'ACCOUNT_OWNS_ESTABLISHMENTS', message: OWNS_CARDS_TEXT },
      });

      const response = await deleteAccount(partner.accessToken).expect(409);
      expect(response.body.error.code).toBe('ACCOUNT_OWNS_ESTABLISHMENTS');
      expect(response.body.message).toBe(OWNS_CARDS_TEXT);
      expect(await userRow(partner.user.id)).toMatchObject({
        email: partner.user.email, name: 'Test Partner', is_active: true,
      });
      expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE id = $1', [establishment.id])).toBe(1);
      expect(await deletionEntries(partner.user.id)).toHaveLength(0);
    },
  );

  test('отклонённая карточка, которая уже была в каталоге, тоже держит учётку', async () => {
    const { partner, establishment } = await createPartnerWithEstablishment('rejected');
    await query('UPDATE establishments SET published_at = NOW() WHERE id = $1', [establishment.id]);

    // Вопрос экрана говорит это до того, как набрано слово.
    const check = await deletionCheck(partner.accessToken).expect(200);
    expect(check.body.data).toEqual({
      allowed: false,
      refusal: { code: 'ACCOUNT_OWNS_ESTABLISHMENTS', message: OWNS_CARDS_TEXT },
    });
    const response = await deleteAccount(partner.accessToken).expect(409);

    expect(response.body.error.code).toBe('ACCOUNT_OWNS_ESTABLISHMENTS');
  });

  test('черновик и отклонённая без публикации уходят вместе с учёткой, каждая — с записью журнала', async () => {
    const { partner, establishment: draft } = await createPartnerWithEstablishment('draft');
    const rejected = await addCard(partner.user.id, 'rejected');

    expect((await deletionCheck(partner.accessToken).expect(200)).body.data)
      .toEqual({ allowed: true, refusal: null });
    await deleteAccount(partner.accessToken).expect(200);

    expect(await count(
      'SELECT COUNT(*)::int AS n FROM establishments WHERE id = ANY($1::uuid[])', [[draft.id, rejected.id]],
    )).toBe(0);
    const journal = await query(
      `SELECT entity_id, user_id, old_data, new_data FROM audit_log
       WHERE action = 'partner_delete_establishment' ORDER BY old_data->>'status'`,
    );
    expect(journal.rows).toEqual([
      {
        entity_id: draft.id,
        user_id: partner.user.id,
        old_data: { name: 'Test Establishment', city: 'Минск', status: 'draft' },
        new_data: null,
      },
      {
        entity_id: rejected.id,
        user_id: partner.user.id,
        old_data: { name: 'Карточка', city: 'Минск', status: 'rejected' },
        new_data: null,
      },
    ]);
    expect((await deletionEntries(partner.user.id))[0].new_data.drafts_deleted).toBe(2);
  });

  test('черновик, отправленный на проверку во время удаления, держит учётку', async () => {
    const { partner, establishment } = await createPartnerWithEstablishment('draft');

    // Отправка на проверку держит строку карточки, пока удаление её ждёт.
    const holder = await getClient();
    await holder.query('BEGIN');
    await holder.query(`UPDATE establishments SET status = 'pending' WHERE id = $1`, [establishment.id]);
    const deletion = deleteAccount(partner.accessToken).then((response) => response);
    try {
      await waitForLockWaiters(1);
    } finally {
      await holder.query('COMMIT');
      holder.release();
    }
    const response = await deletion;

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACCOUNT_OWNS_ESTABLISHMENTS');
    expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE id = $1', [establishment.id])).toBe(1);
    expect((await userRow(partner.user.id)).is_active).toBe(true);
  });

  test('учётка панели — 409, её удаляет оператор', async () => {
    const viewer = await createViewerAndGetToken();

    const response = await deleteAccount(viewer.accessToken).expect(409);

    expect(response.body.error.code).toBe('ACCOUNT_OPERATOR_MANAGED');
    expect(response.body.message).toBe('Эту учётную запись удаляет оператор платформы. Напишите в поддержку: support@nirivio.by');
    expect((await userRow(viewer.user.id)).is_active).toBe(true);
  });

  test('служебная учётка — 409, её удаляет оператор', async () => {
    const p = await person();
    await query('UPDATE users SET is_service_account = TRUE WHERE id = $1', [p.id]);

    const check = await deletionCheck(p.accessToken).expect(200);
    expect(check.body.data.refusal.code).toBe('ACCOUNT_OPERATOR_MANAGED');
    await deleteAccount(p.accessToken).expect(409);
    expect((await userRow(p.id)).email).toBe(p.email);
  });

  test('обычной учётке проверка отвечает «можно»', async () => {
    const p = await person();

    const check = await deletionCheck(p.accessToken).expect(200);

    expect(check.body).toEqual({ success: true, data: { allowed: true, refusal: null } });
  });
});

// ============================================================================
// Повтор и гонка
// ============================================================================

describe('DELETE /auth/account — два запроса разом', () => {
  test('удаление одно: журнал — одна запись, оба ответа «удалена»', async () => {
    const p = await person();

    // Держим строку учётки, пока оба запроса не встанут за ней в очередь.
    const holder = await getClient();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [p.id]);
    const first = deleteAccount(p.accessToken).then((response) => response);
    const second = deleteAccount(p.accessToken).then((response) => response);
    try {
      await waitForLockWaiters(2);
    } finally {
      await holder.query('COMMIT');
      holder.release();
    }
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.data)).toEqual([{ deleted: true }, { deleted: true }]);
    expect(await deletionEntries(p.id)).toHaveLength(1);
  });
});

// ============================================================================
// Панель не возвращает удалённую учётку
// ============================================================================

describe('Панель: удалённую учётку не блокируют, не включают и не переименовывают', () => {
  test.each([
    ['block', { reason: 'Проверка' }],
    ['unblock', { reason: 'Проверка' }],
    ['reset-name', { reason: 'Проверка' }],
  ])('%s — 409, учётка остаётся удалённой', async (action, body) => {
    const admin = await createAdminAndGetToken();
    const p = await person();
    await deleteAccount(p.accessToken).expect(200);

    const response = await request(app)
      .post(`/api/v1/admin/users/${p.id}/${action}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send(body)
      .expect(409);

    expect(response.body.error.code).toBe('ACCOUNT_DELETED');
    expect(response.body.message).toBe(
      'Учётная запись удалена. Удалённую учётную запись не блокируют, не включают и не переименовывают',
    );
    expect(await userRow(p.id)).toMatchObject({ name: 'Гость', is_active: false, email: null });
  });
});

// ============================================================================
// Фото профиля
// ============================================================================

describe('DELETE /auth/account — фото профиля', () => {
  test('своё фото в облаке уничтожается по точному public_id — вместе с копиями CDN', async () => {
    const destroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    const p = await person();
    await query(
      'UPDATE users SET avatar_url = $1 WHERE id = $2',
      [`https://res.cloudinary.com/test/image/upload/v1759600000/avatars/${p.id}/face0001.jpg`, p.id],
    );

    await deleteAccount(p.accessToken).expect(200);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(`avatars/${p.id}/face0001`, { invalidate: true });
  });

  test('фото из Google или Яндекса не наше — облако не трогается', async () => {
    const destroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    const p = await person();
    await query(`UPDATE users SET avatar_url = 'https://lh3.googleusercontent.com/a/face' WHERE id = $1`, [p.id]);

    await deleteAccount(p.accessToken).expect(200);

    expect(destroy).not.toHaveBeenCalled();
    expect((await userRow(p.id)).avatar_url).toBeNull();
  });
});

// ============================================================================
// Юридические данные карточки, переданной другому
// ============================================================================

describe('DELETE /auth/account — юр. данные карточки, которая перешла к другому', () => {
  test('контактное лицо и его почта стёрты, название и УНП на месте', async () => {
    const p = await person();
    const { partner, establishment } = await createPartnerWithEstablishment('active');
    // Карточка была у человека, документы записаны на него; потом её передали.
    await query(
      `INSERT INTO partner_documents (partner_id, establishment_id, document_type, document_url,
                                      company_name, tax_id, contact_person, contact_email)
       VALUES ($1, $2, 'registration_certificate', '', 'ООО «Вкус»', '191234567', 'Иван Тестов', $3)`,
      [p.id, establishment.id, p.email],
    );
    expect(partner.user.id).not.toBe(p.id);

    await deleteAccount(p.accessToken).expect(200);

    const docs = await query(
      'SELECT company_name, tax_id, contact_person, contact_email FROM partner_documents WHERE establishment_id = $1',
      [establishment.id],
    );
    expect(docs.rows).toEqual([
      { company_name: 'ООО «Вкус»', tax_id: '191234567', contact_person: null, contact_email: null },
    ]);
  });

  test('передача, затем новый владелец вписал свои контакты, затем прежний удалил учётку — контакты нового на месте', async () => {
    // Обычный путь решения 3: сначала передать карточки, потом удалить
    // учётку (Phase 3.5, линза, 18.10).
    const admin = await createAdminAndGetToken();
    const { partner: previous, establishment } = await createPartnerWithEstablishment('active');
    await query(
      `INSERT INTO partner_documents (partner_id, establishment_id, document_type, document_url,
                                      company_name, tax_id, contact_person, contact_email)
       VALUES ($1, $2, 'registration_certificate', '', 'ООО «Вкус»', '191234567', 'Test Partner', $3)`,
      [previous.user.id, establishment.id, previous.user.email],
    );
    const { partner: next } = await createPartnerWithEstablishment('active');
    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/claim`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ user_id: next.user.id })
      .expect(200);
    await request(app)
      .put(`/api/v1/partner/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${next.accessToken}`)
      .send({ contact_person: 'Пётр Новиков', contact_email: 'petr@test.com' })
      .expect(200);

    await deleteAccount(previous.accessToken).expect(200);

    const docs = await query(
      'SELECT partner_id, company_name, tax_id, contact_person, contact_email FROM partner_documents WHERE establishment_id = $1',
      [establishment.id],
    );
    expect(docs.rows).toEqual([{
      partner_id: next.user.id, company_name: 'ООО «Вкус»', tax_id: '191234567',
      contact_person: 'Пётр Новиков', contact_email: 'petr@test.com',
    }]);
    expect((await userRow(previous.user.id)).name).toBe('Гость');
  });
});

// ============================================================================
// Карточка без даты публикации, которой пользовались другие (Phase 3.5, линза)
// ============================================================================

describe('DELETE /auth/account — неопубликованная карточка с чужими следами держит учётку', () => {
  // Старый сид оставлял published_at пустым у карточек, что были в каталоге;
  // чужие отзывы, избранное или брони — то доказательство, которого не даёт
  // дата. Такая карточка не уходит каскадом вместе с чужими данными.
  test.each([
    ['отзыв', (cardId, otherId) => createTestReview(otherId, cardId, { rating: 4, content: 'Был там до закрытия' })],
    ['избранное', (cardId, otherId) => query(
      'INSERT INTO favorites (user_id, establishment_id) VALUES ($1, $2)', [otherId, cardId],
    )],
    ['бронь', (cardId, otherId) => addBooking(cardId, otherId, { status: 'completed', dayOffset: -30 })],
  ])('%s другого человека на отклонённой карточке — 409, карточка и его данные на месте', async (_, leaveTrace) => {
    const { partner, establishment } = await createPartnerWithEstablishment('rejected');
    const other = await person({ name: 'Другой Гость' });
    await leaveTrace(establishment.id, other.id);

    const check = await deletionCheck(partner.accessToken).expect(200);
    expect(check.body.data.refusal.code).toBe('ACCOUNT_OWNS_ESTABLISHMENTS');
    const response = await deleteAccount(partner.accessToken).expect(409);

    expect(response.body.error.code).toBe('ACCOUNT_OWNS_ESTABLISHMENTS');
    expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE id = $1', [establishment.id])).toBe(1);
    expect(await count(
      `SELECT ((SELECT COUNT(*) FROM reviews WHERE user_id = $1)
            + (SELECT COUNT(*) FROM favorites WHERE user_id = $1)
            + (SELECT COUNT(*) FROM bookings WHERE user_id = $1))::int AS n`,
      [other.id],
    )).toBe(1);
    expect((await userRow(partner.user.id)).is_active).toBe(true);
  });

  test('свой отзыв на своём черновике чужим следом не считается — черновик уходит', async () => {
    const { partner, establishment } = await createPartnerWithEstablishment('draft');
    await createTestReview(partner.user.id, establishment.id, { rating: 5, content: 'Проба' });

    await deleteAccount(partner.accessToken).expect(200);

    expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE id = $1', [establishment.id])).toBe(0);
  });
});

// ============================================================================
// Журнал: имя и почта человека уходят и из прежних записей (Phase 3.5)
// ============================================================================

describe('DELETE /auth/account — прежние записи журнала о человеке', () => {
  test('сброс имени и смена почты больше не хранят ни имени, ни адресов; причина остаётся', async () => {
    const p = await person();
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
       VALUES (NULL, 'user_reset_name', 'user', $1, $2, $3),
              (NULL, 'change_email', 'user', $1, $4, $5)`,
      [
        p.id,
        JSON.stringify({ user_name: 'Иван Тестов' }),
        JSON.stringify({ user_name: 'Пользователь', reason: 'Имя-реклама' }),
        JSON.stringify({ user_email: 'old-address@test.com' }),
        JSON.stringify({ user_email: p.email }),
      ],
    );

    await deleteAccount(p.accessToken).expect(200);

    const entries = (await query(
      `SELECT action, old_data, new_data FROM audit_log
       WHERE entity_type = 'user' AND entity_id = $1 AND action IN ('user_reset_name', 'change_email')
       ORDER BY action`,
      [p.id],
    )).rows;
    expect(entries).toEqual([
      { action: 'change_email', old_data: {}, new_data: {} },
      { action: 'user_reset_name', old_data: {}, new_data: { reason: 'Имя-реклама' } },
    ]);
  });
});

// ============================================================================
// Вход через Яндекс в гонке с удалением (Phase 3.5: оба ревьюера)
// ============================================================================

describe('Вход через Яндекс, начатый до удаления и записывающий после него, не трогает удалённую запись', () => {
  const yandex = oauthProviderResponses.yandex;
  const loginYandex = () => request(app)
    .post(`${AUTH}/oauth`)
    .send({ provider: 'yandex', token: 'oauth-token-1234567890' });

  /** То, что удаление пишет в строку учётки (accountDeletionService). */
  const anonymiseInPlace = (client, userId) => client.query(
    `UPDATE users
        SET email = NULL, phone = NULL, password_hash = NULL, oauth_provider_id = NULL,
            name = 'Гость', avatar_url = NULL, email_verified = FALSE, phone_verified = FALSE,
            last_login_at = NULL, is_active = FALSE
      WHERE id = $1`,
    [userId],
  );

  /**
   * Вход читает запись, пока её держит транзакция теста; его запись в строку
   * ждёт блокировку; транзакция обезличивает запись и коммитит — запись входа
   * идёт уже по удалённой строке.
   */
  const loginRacingDeletion = async (userId) => {
    const holder = await getClient();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const login = loginYandex().then((response) => response);
    try {
      await waitForLockWaiters(1);
      await anonymiseInPlace(holder, userId);
      await holder.query('COMMIT');
    } catch (error) {
      await holder.query('ROLLBACK');
      throw error;
    } finally {
      holder.release();
    }
    return login;
  };

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => yandex });
  });

  test('вход прежней учётки Яндекса — отказ, в запись не пишется даже время входа', async () => {
    const first = await loginYandex().expect(200);
    const id = first.body.data.user.id;

    const raced = await loginRacingDeletion(id);

    expect(raced.status).toBe(403);
    expect(raced.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    expect(await userRow(id)).toMatchObject({ last_login_at: null, oauth_provider_id: null, is_active: false });
  });

  test('привязка Яндекса к учётке по почте — отказ; следующий вход открывает новую учётку', async () => {
    const owner = await createUserAndGetTokens({
      email: yandex.default_email, password: PASSWORD, name: 'Иван Почтовый', role: 'user', authMethod: 'email',
    });
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [owner.user.id]);

    const raced = await loginRacingDeletion(owner.user.id);

    expect(raced.status).toBe(403);
    expect(await userRow(owner.user.id)).toMatchObject({
      oauth_provider_id: null, email_verified: false, auth_method: 'email', is_active: false,
    });
    const next = await loginYandex().expect(200);
    expect(next.body.data.user.id).not.toBe(owner.user.id);
  });

  test('переход неподтверждённой записи к владельцу почты — отказ; имя и фото Яндекса не пишутся', async () => {
    const owner = await createUserAndGetTokens({
      email: yandex.default_email, password: PASSWORD, name: 'Иван Неподтверждённый', role: 'user', authMethod: 'email',
    });

    const raced = await loginRacingDeletion(owner.user.id);

    expect(raced.status).toBe(403);
    expect(await userRow(owner.user.id)).toMatchObject({
      name: 'Гость', avatar_url: null, oauth_provider_id: null, is_active: false,
    });
  });
});

// ============================================================================
// Бронь, отправленная во время удаления (Phase 3.5, первый круг, R6)
// ============================================================================

describe('Бронь, отправленная во время удаления, не ложится после него', () => {
  test('запрос ждёт удаление и получает отказ; брони с телефоном у удалённой учётки нет', async () => {
    // Запрос прошёл все проверки до того, как удаление закоммитило, и ждал
    // только внешний ключ: бронь ложилась после удаления — с телефоном, который
    // оно только что стёрло у остальных броней, и впереди, то есть не отменённой.
    const p = await person({ phone: '+375291112277' });
    const { establishment } = await createPartnerWithEstablishment('active');
    await query('UPDATE establishments SET booking_enabled = TRUE WHERE id = $1', [establishment.id]);
    await query(
      `INSERT INTO booking_settings (establishment_id, is_enabled, min_hours_before, max_days_ahead,
                                     confirmation_timeout_hours)
       VALUES ($1, TRUE, 1, 7, 4)`,
      [establishment.id],
    );
    const tomorrow = (await query("SELECT to_char((NOW() AT TIME ZONE 'Europe/Minsk')::date + 1, 'YYYY-MM-DD') AS d")).rows[0].d;

    // Транзакция теста — само удаление: держит строку учётки, пока запрос брони
    // встаёт за ней, затем обезличивает учётку и коммитит.
    const holder = await getClient();
    let response;
    try {
      await holder.query('BEGIN');
      const account = await lockAccount(holder, p.id);
      const booking = request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${p.accessToken}`)
        .send({ establishmentId: establishment.id, date: tomorrow, time: '12:00', guestCount: 2, contactPhone: '+375291112277' })
        .then((r) => r);
      await waitForLockWaiters(1);
      await anonymiseAccount(holder, account, { userId: p.id });
      await holder.query('COMMIT');
      response = await booking;
    } catch (error) {
      await holder.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      holder.release();
    }

    expect({ status: response.status, code: response.body.error?.code }).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(response.body.message).toBe('Учётная запись отключена — забронировать нельзя');
    expect(await count('SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = $1', [p.id])).toBe(0);
  });
});
