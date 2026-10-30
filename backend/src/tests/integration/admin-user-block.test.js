/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Блокировка из панели (проход тестировщика 17.10, п. 8; решение
 * Координатора В9).
 *
 * Модератор находит человека по почте, телефону или имени, блокирует его с
 * причиной — отключение аккаунта плюс скрытие всех его видимых отзывов, —
 * разблокирует, возвращая только скрытое блокировкой, сбрасывает имя на
 * «Пользователь». Всё — в журнал. Действует только admin; учётки панели,
 * служебная учётка и партнёр с карточками кнопкой не блокируются.
 *
 * На старом коде (до П8) каждый тест здесь красный: маршрутов /admin/users,
 * /admin/users/:id/block|unblock|reset-name не было — 404 на любой запрос.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import * as AdminUserService from '../../services/adminUserService.js';
import { AUTH_REFUSALS, SUPPORT_EMAIL } from '../../constants/authRefusals.js';
import * as ReviewService from '../../services/reviewService.js';
import { getClient } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createViewerAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
} from '../utils/adminTestHelpers.js';

const ADMIN = '/api/v1/admin';
const PASSWORD = 'Person123!@#';

let admin;
let viewer;

const asAdmin = (method, url, body) => request(app)[method](`${ADMIN}${url}`)
  .set('Authorization', `Bearer ${admin.accessToken}`)
  .send(body);

const asViewer = (method, url, body) => request(app)[method](`${ADMIN}${url}`)
  .set('Authorization', `Bearer ${viewer.accessToken}`)
  .send(body);

/** Человек, вошедший по паролю: с живыми токенами, как из приложения. */
const person = async ({ name = 'Иван Тестов', phone = null, role = 'user' } = {}) => {
  const email = `person-${randomUUID()}@test.com`;
  const created = await createUserAndGetTokens({
    email, phone, password: PASSWORD, name, role, authMethod: 'email',
  });
  return { ...created, email, id: created.user.id };
};

const reviewState = async (id) => (await query(
  'SELECT is_visible, is_deleted FROM reviews WHERE id = $1', [id],
)).rows[0];

/**
 * Ждать, пока чей-то запрос встанет в очередь за блокировкой строки: так тест
 * знает, что гонка разыграна, а не угадывает паузой.
 */
const waitForLockWaiter = async () => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error('никто не ждёт блокировки строки');
};

const journal = async (userId, action) => (await query(
  `SELECT user_id, old_data, new_data FROM audit_log
   WHERE entity_type = 'user' AND entity_id = $1 AND action = $2
   ORDER BY created_at`,
  [userId, action],
)).rows;

beforeAll(async () => {
  admin = await createAdminAndGetToken();
  viewer = await createViewerAndGetToken();
});

afterAll(async () => {
  await clearAllData();
});

describe('GET /admin/users — найти человека', () => {
  let target;

  beforeAll(async () => {
    target = await person({ name: `Искомый Человек`, phone: '+375291234567' });
    const { establishment } = await createPartnerWithEstablishment('active');
    await createTestReview(target.id, establishment.id, { rating: 2 });
  });

  test.each([
    ['по почте', () => target.email.slice(0, 20)],
    ['по имени', () => 'искомый'],
    ['по телефону с пробелами', () => '29 123 45'],
  ])('находит %s', async (_, search) => {
    const { body } = await asAdmin('get', `/users?search=${encodeURIComponent(search())}`).expect(200);
    expect(body.data.map((u) => u.id)).toContain(target.id);
    const found = body.data.find((u) => u.id === target.id);
    expect(found).toMatchObject({
      name: 'Искомый Человек',
      email: target.email,
      phone: '+375291234567',
      role: 'user',
      is_active: true,
      review_count: 1,
      hidden_review_count: 0,
      establishment_count: 0,
    });
  });

  test('карточка человека: роль, состояние, сколько отзывов', async () => {
    const { body } = await asAdmin('get', `/users/${target.id}`).expect(200);
    expect(body.data).toMatchObject({
      id: target.id,
      name: 'Искомый Человек',
      is_active: true,
      review_count: 1,
      last_block_action: null,
    });
  });

  test('несуществующий и кривой id — «Пользователь не найден»', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      const { body } = await asAdmin('get', `/users/${id}`).expect(404);
      expect(body.message).toBe('Пользователь не найден');
    }
  });

  test('просмотрщик видит список без имён и контактов и не ищет', async () => {
    const { body } = await asViewer('get', '/users?per_page=50').expect(200);
    const row = body.data.find((u) => u.id === target.id);
    expect(row).toMatchObject({
      name: null, email: null, phone: null, is_active: true, viewer_redacted: true,
    });
    expect(JSON.stringify(body)).not.toContain(target.email);

    const search = await asViewer('get', '/users?search=%D0%98%D1%81%D0%BA').expect(403);
    expect(search.body.message).toBe('Поиск людей недоступен в режиме просмотра');
  });

  test('просмотрщику кнопки не служат: сервер отказывает', async () => {
    for (const action of ['block', 'unblock', 'reset-name']) {
      await asViewer('post', `/users/${target.id}/${action}`, { reason: 'проверка' }).expect(403);
    }
    expect((await query('SELECT is_active, name FROM users WHERE id = $1', [target.id])).rows[0])
      .toEqual({ is_active: true, name: 'Искомый Человек' });
  });
});

describe('POST /admin/users/:id/block и /unblock', () => {
  let target;
  let establishment;
  let otherEstablishment;
  let visibleA;
  let visibleB;
  let hiddenByModerator;
  let deleted;

  beforeAll(async () => {
    target = await person({ name: 'Матерщинник' });
    // Что блокировка гасит кроме сеансов (директива Б4, authService.endAllAccess):
    // телефон с push и неиспользованную ссылку сброса пароля.
    await query("INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, $2, 'android')",
      [target.id, `fcm-${randomUUID()}`]);
    await query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')",
      [target.id, `hash-${randomUUID()}`],
    );
    const { rows: [seeded] } = await query(
      `SELECT (SELECT COUNT(*)::int FROM device_tokens WHERE user_id = $1 AND is_active = TRUE) AS active_devices,
              (SELECT COUNT(*)::int FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL) AS live_links`,
      [target.id],
    );
    expect(seeded).toEqual({ active_devices: 1, live_links: 1 }); // there is something to switch off
    establishment = (await createPartnerWithEstablishment('active')).establishment;
    otherEstablishment = (await createPartnerWithEstablishment('active')).establishment;

    visibleA = await createTestReview(target.id, establishment.id, { rating: 1 });
    visibleB = await createTestReview(target.id, otherEstablishment.id, { rating: 1 });
    // Ещё один чужой отзыв на первом месте: рейтинг после скрытия — его пятёрка.
    await createTestReview(null, establishment.id, { rating: 5 });

    const third = (await createPartnerWithEstablishment('active')).establishment;
    hiddenByModerator = await createTestReview(target.id, third.id, { rating: 2 });
    await asAdmin('post', `/reviews/${hiddenByModerator.id}/visibility`, { is_visible: false }).expect(200);

    const fourth = (await createPartnerWithEstablishment('active')).establishment;
    deleted = await createTestReview(target.id, fourth.id, { rating: 2 });
    await asAdmin('post', `/reviews/${deleted.id}/delete`, { reason: 'спам' }).expect(200);
  });

  test('без причины — отказ по-русски, и ничего не меняется', async () => {
    // Обе кнопки описания: и блокировка, и разблокировка — у каждой своя проверка причины.
    for (const action of ['block', 'unblock']) {
      for (const reason of [undefined, '', '   ']) {
        const { body } = await asAdmin('post', `/users/${target.id}/${action}`, { reason }).expect(422);
        expect({ action, message: body.message }).toEqual({ action, message: 'Укажите причину' });
      }
      const long = await asAdmin('post', `/users/${target.id}/${action}`, { reason: 'я'.repeat(501) }).expect(422);
      expect(long.body.message).toMatch(/^Причина длиннее 500 символов/);
    }
    expect((await query('SELECT is_active FROM users WHERE id = $1', [target.id])).rows[0].is_active)
      .toBe(true);
  });

  test('блокировка: аккаунт выключен, все видимые отзывы скрыты, рейтинг пересчитан, журнал', async () => {
    // Токен греет кэш статуса аккаунта — блокировка обязана его сбросить.
    await request(app).get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${target.accessToken}`).expect(200);

    const { body } = await asAdmin('post', `/users/${target.id}/block`, { reason: '  мат в отзывах  ' })
      .expect(200);
    expect(body.data).toEqual({ id: target.id, is_active: false, changed: true, hidden_reviews: 2 });

    expect((await query('SELECT is_active FROM users WHERE id = $1', [target.id])).rows[0].is_active)
      .toBe(false);
    expect(await reviewState(visibleA.id)).toEqual({ is_visible: false, is_deleted: false });
    expect(await reviewState(visibleB.id)).toEqual({ is_visible: false, is_deleted: false });

    const rating = (await query(
      'SELECT average_rating::float8 AS r, review_count FROM establishments WHERE id = $1',
      [establishment.id],
    )).rows[0];
    expect(rating).toEqual({ r: 5, review_count: 1 });

    const [entry] = await journal(target.id, 'user_block');
    expect(entry.user_id).toBe(admin.user.id);
    expect(entry.old_data).toEqual({ is_active: true });
    expect(entry.new_data.reason).toBe('мат в отзывах');
    expect([...entry.new_data.hidden_review_ids].sort()).toEqual([visibleA.id, visibleB.id].sort());
  });

  test('заблокированный не входит, не обновляет токен, старый токен отвергнут, push выключен', async () => {
    await request(app).post('/api/v1/auth/login')
      .send({ email: target.email, password: PASSWORD }).expect(401);
    await request(app).post('/api/v1/auth/refresh')
      .send({ refreshToken: target.refreshToken }).expect(401);
    await request(app).get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${target.accessToken}`).expect(401);
    const live = await query(
      'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND used_at IS NULL',
      [target.id],
    );
    expect(live.rows[0].n).toBe(0);

    // «push выключен» — и ссылка сброса, выданная до блокировки, погашена:
    // действующих не осталось (что они были, проверено при подготовке).
    const { rows: [left] } = await query(
      `SELECT (SELECT COUNT(*)::int FROM device_tokens WHERE user_id = $1 AND is_active = TRUE) AS active_devices,
              (SELECT COUNT(*)::int FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL) AS live_links`,
      [target.id],
    );
    expect(left).toEqual({ active_devices: 0, live_links: 0 });
  });

  test('повтор блокировки ничего не пишет второй раз', async () => {
    const { body } = await asAdmin('post', `/users/${target.id}/block`, { reason: 'повтор' }).expect(200);
    expect(body.data).toMatchObject({ is_active: false, changed: false });
    expect(await journal(target.id, 'user_block')).toHaveLength(1);
  });

  test('карточка заблокированного: причина и кто', async () => {
    const { body } = await asAdmin('get', `/users/${target.id}`).expect(200);
    expect(body.data).toMatchObject({ is_active: false, review_count: 3, hidden_review_count: 3 });
    expect(body.data.last_block_action).toMatchObject({
      action: 'user_block',
      reason: 'мат в отзывах',
      admin_name: admin.user.name,
    });

    const asSeen = await asViewer('get', `/users/${target.id}`).expect(200);
    expect(asSeen.body.data).toMatchObject({
      name: null, hidden_review_count: null, review_count: 0,
    });
    // Причина — свободный текст модератора о человеке: просмотрщику нет.
    expect(asSeen.body.data.last_block_action).toMatchObject({
      action: 'user_block', admin_name: null, reason: null,
    });
  });

  test('разблокировка возвращает только скрытое блокировкой', async () => {
    // Пока человек заблокирован, модератор взял отзыв B в свои руки: показал
    // и снова скрыл. Теперь это решение модератора, не блокировки.
    await asAdmin('post', `/reviews/${visibleB.id}/visibility`, { is_visible: true }).expect(200);
    await asAdmin('post', `/reviews/${visibleB.id}/visibility`, { is_visible: false }).expect(200);

    const { body } = await asAdmin('post', `/users/${target.id}/unblock`, { reason: 'извинился' })
      .expect(200);
    // block_hidden_reviews — сколько скрыла блокировка (2: A и B), чтобы
    // панель сказала «возвращено 1 из 2» (проход по панели 20.10, A2-06).
    expect(body.data).toEqual({
      id: target.id,
      is_active: true,
      changed: true,
      restored_reviews: 1,
      block_hidden_reviews: 2,
      block_by_operator: false,
      block_found: true,
    });

    expect(await reviewState(visibleA.id)).toEqual({ is_visible: true, is_deleted: false });
    expect(await reviewState(visibleB.id)).toEqual({ is_visible: false, is_deleted: false });
    expect(await reviewState(hiddenByModerator.id)).toEqual({ is_visible: false, is_deleted: false });
    expect(await reviewState(deleted.id)).toEqual({ is_visible: true, is_deleted: true });

    const rating = (await query(
      'SELECT average_rating::float8 AS r, review_count FROM establishments WHERE id = $1',
      [establishment.id],
    )).rows[0];
    expect(rating).toEqual({ r: 3, review_count: 2 });

    const [entry] = await journal(target.id, 'user_unblock');
    expect(entry.new_data).toEqual({
      is_active: true, reason: 'извинился', restore_reviews: true, restored_review_ids: [visibleA.id],
    });

    await request(app).post('/api/v1/auth/login')
      .send({ email: target.email, password: PASSWORD }).expect(200);
  });

  test('вторая блокировка после разблокировки возвращает свой список, а не первый', async () => {
    // Отзыв, написанный между разблокировкой и второй блокировкой, есть только
    // во втором списке: прочитай разблокировка первый — он остался бы скрытым.
    const fifth = (await createPartnerWithEstablishment('active')).establishment;
    const newer = await createTestReview(target.id, fifth.id, { rating: 4 });

    await asAdmin('post', `/users/${target.id}/block`, { reason: 'снова' }).expect(200);
    expect(await reviewState(newer.id)).toEqual({ is_visible: false, is_deleted: false });

    await asAdmin('post', `/users/${target.id}/unblock`, { reason: 'снова прощён' }).expect(200);
    expect(await reviewState(newer.id)).toEqual({ is_visible: true, is_deleted: false });
    expect(await reviewState(visibleA.id)).toEqual({ is_visible: true, is_deleted: false });
    expect(await reviewState(visibleB.id)).toEqual({ is_visible: false, is_deleted: false });
  });

  test('разблокировка без возврата отзывов: они остаются скрытыми решением модератора', async () => {
    const other = await person({ name: 'Без Возврата' });
    const review = await createTestReview(other.id, establishment.id, { rating: 1 });
    await asAdmin('post', `/users/${other.id}/block`, { reason: 'мат в отзыве' }).expect(200);

    const bad = await asAdmin('post', `/users/${other.id}/unblock`, { reason: 'x', restore_reviews: 'нет' })
      .expect(422);
    expect(bad.body.message).toMatch(/^Не понятно, возвращать ли отзывы/);

    const { body } = await asAdmin('post', `/users/${other.id}/unblock`, {
      reason: 'человека простили, отзыв — нет',
      restore_reviews: false,
    }).expect(200);
    expect(body.data).toMatchObject({ is_active: true, changed: true, restored_reviews: 0 });
    expect(await reviewState(review.id)).toEqual({ is_visible: false, is_deleted: false });
    const [entry] = await journal(other.id, 'user_unblock');
    expect(entry.new_data).toMatchObject({ restore_reviews: false, restored_review_ids: [] });

    // Следующая блокировка застаёт отзыв уже скрытым — и её разблокировка его не вернёт.
    await asAdmin('post', `/users/${other.id}/block`, { reason: 'снова' }).expect(200);
    await asAdmin('post', `/users/${other.id}/unblock`, { reason: 'снова' }).expect(200);
    expect(await reviewState(review.id)).toEqual({ is_visible: false, is_deleted: false });
  });

  test('отзыв, отправленный в момент блокировки, не остаётся видимым', async () => {
    const racer = await person({ name: 'Отзыв В Полёте' });
    const holder = await getClient();
    let outcome;
    try {
      // Блокировка держит строку человека, пока прячет его отзывы.
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [racer.id]);
      const creating = ReviewService.createReview({
        user_id: racer.id,
        establishment_id: establishment.id,
        rating: 1,
        content: 'Отзыв, отправленный ровно в момент блокировки',
      }).then(() => 'создан', (error) => error);
      await waitForLockWaiter();
      await holder.query('UPDATE users SET is_active = FALSE WHERE id = $1', [racer.id]);
      await holder.query('COMMIT');
      outcome = await creating;
    } finally {
      holder.release();
    }

    expect(outcome).toMatchObject({ statusCode: 403, code: 'USER_INACTIVE' });
    const left = await query('SELECT COUNT(*)::int AS n FROM reviews WHERE user_id = $1', [racer.id]);
    expect(left.rows[0].n).toBe(0);
  });

  test('блокировка, ждавшая чужое действие над человеком, в журнале — после него', async () => {
    const contested = await person({ name: 'Очередь Журнала' });
    const holder = await getClient();
    let blocking;
    try {
      // Строку первым взял другой администратор (разблокировка) и пишет свою
      // запись, пока блокировка ждёт; блокировка начала транзакцию раньше.
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [contested.id]);
      blocking = AdminUserService.blockUser(contested.id, 'очередь', admin.user.id);
      await waitForLockWaiter();
      await holder.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data, created_at)
         VALUES ($1, 'user_unblock', 'user', $2, '{"reason": "раньше"}', clock_timestamp())`,
        [admin.user.id, contested.id],
      );
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }
    await blocking;

    const { body } = await asAdmin('get', `/users/${contested.id}`).expect(200);
    expect(body.data.is_active).toBe(false);
    expect(body.data.last_block_action).toMatchObject({ action: 'user_block', reason: 'очередь' });
  });

  test('аккаунт, выключенный скриптом оператора, включается без возврата отзывов', async () => {
    const other = await person({ name: 'Выключен скриптом' });
    const review = await createTestReview(other.id, establishment.id, { rating: 3, is_visible: false });
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [other.id]);

    const { body } = await asAdmin('post', `/users/${other.id}/unblock`, { reason: 'проверка' }).expect(200);
    expect(body.data).toMatchObject({ is_active: true, changed: true, restored_reviews: 0 });
    expect(await reviewState(review.id)).toEqual({ is_visible: false, is_deleted: false });
  });
});

describe('кого кнопка не блокирует', () => {
  test.each([
    ['себя', async () => admin.user.id, 'Нельзя заблокировать или переименовать самого себя'],
    ['администратора', async () => (await person({ role: 'admin' })).id, /^Это учётная запись панели/],
    ['просмотрщика', async () => viewer.user.id, /^Это учётная запись панели/],
    ['служебную учётку', async () => {
      const seedHouse = await person({ role: 'partner' });
      await query('UPDATE users SET is_service_account = TRUE WHERE id = $1', [seedHouse.id]);
      return seedHouse.id;
    }, /^Это служебная учётная запись платформы/],
    ['партнёра с карточкой в каталоге', async () => (await createPartnerWithEstablishment('active')).partner.user.id,
      /^У этого партнёра есть карточки заведений в каталоге или на модерации/],
    ['партнёра с карточкой на модерации', async () => (await createPartnerWithEstablishment('pending')).partner.user.id,
      /^У этого партнёра есть карточки заведений в каталоге или на модерации/],
    ['приостановленного партнёра', async () => (await createPartnerWithEstablishment('suspended')).partner.user.id,
      /^У этого партнёра есть карточки заведений в каталоге или на модерации/],
  ])('%s — отказ 409 с понятным текстом', async (_, targetId, message) => {
    const id = await targetId();
    const { body } = await asAdmin('post', `/users/${id}/block`, { reason: 'проверка' }).expect(409);
    expect(body.message).toEqual(expect.stringMatching(message));
    expect((await query('SELECT is_active FROM users WHERE id = $1', [id])).rows[0].is_active).toBe(true);
    expect(await journal(id, 'user_block')).toHaveLength(0);
  });

  test('партнёра без карточек блокировать можно', async () => {
    const partner = await person({ role: 'partner' });
    await asAdmin('post', `/users/${partner.id}/block`, { reason: 'мусор' }).expect(200);
    expect((await query('SELECT is_active FROM users WHERE id = $1', [partner.id])).rows[0].is_active)
      .toBe(false);
  });

  test.each(['draft', 'rejected', 'archived'])(
    'карточка в статусе %s не защищает: черновик заводит любой пользователь',
    async (status) => {
      const { partner } = await createPartnerWithEstablishment(status);
      const card = await asAdmin('get', `/users/${partner.user.id}`).expect(200);
      expect(card.body.data).toMatchObject({ establishment_count: 1, live_establishment_count: 0 });

      await asAdmin('post', `/users/${partner.user.id}/block`, { reason: 'мусорный черновик' }).expect(200);
      expect((await query('SELECT is_active FROM users WHERE id = $1', [partner.user.id])).rows[0].is_active)
        .toBe(false);
    },
  );
});

describe('POST /admin/users/:id/reset-name', () => {
  test('имя становится «Пользователь» и на прошлых отзывах; старое — в журнале', async () => {
    const target = await person({ name: 'Матерное Имя' });
    const { establishment } = await createPartnerWithEstablishment('active');
    await createTestReview(target.id, establishment.id, { rating: 4 });

    await asAdmin('post', `/users/${target.id}/reset-name`, {}).expect(422);

    const { body } = await asAdmin('post', `/users/${target.id}/reset-name`, { reason: 'мат в имени' })
      .expect(200);
    expect(body.data).toEqual({ id: target.id, name: 'Пользователь', changed: true });

    const reviews = await request(app).get(`/api/v1/establishments/${establishment.id}/reviews`).expect(200);
    expect(JSON.stringify(reviews.body)).not.toContain('Матерное Имя');
    expect(JSON.stringify(reviews.body)).toContain('Пользователь');

    const [entry] = await journal(target.id, 'user_reset_name');
    expect(entry.old_data).toEqual({ user_name: 'Матерное Имя' });
    expect(entry.new_data).toEqual({ user_name: 'Пользователь', reason: 'мат в имени' });

    const repeat = await asAdmin('post', `/users/${target.id}/reset-name`, { reason: 'повтор' }).expect(200);
    expect(repeat.body.data.changed).toBe(false);
    expect(await journal(target.id, 'user_reset_name')).toHaveLength(1);

    // Журнал: администратору — кто это был, просмотрщику — нет.
    const asAdminLog = await asAdmin('get', '/audit-log?entity_type=user&per_page=100').expect(200);
    const row = asAdminLog.body.data.find((e) => e.entity_id === target.id && e.action === 'user_reset_name');
    expect(row.summary).toBe('Имя пользователя сброшено');
    expect(row.entity_context).toEqual({ user_name: 'Пользователь' });
    expect(row.old_data).toEqual({ user_name: 'Матерное Имя' });

    const asViewerLog = await asViewer('get', '/audit-log?entity_type=user&per_page=100').expect(200);
    expect(JSON.stringify(asViewerLog.body)).not.toContain('Матерное Имя');
    // Ни причин, ни списков отзывов у блокировок и сбросов имени: просмотрщик
    // знает, что и когда, но не чьи отзывы были скрыты.
    const moderation = new Set(['user_block', 'user_unblock', 'user_reset_name']);
    const people = asViewerLog.body.data.filter((e) => moderation.has(e.action));
    expect(new Set(people.map((e) => e.action))).toEqual(moderation);
    for (const entry of people) {
      expect({ action: entry.action, old_data: entry.old_data, new_data: entry.new_data })
        .toEqual({ action: entry.action, old_data: null, new_data: null });
    }
  });

  test('учётку панели не переименовать', async () => {
    const { body } = await asAdmin('post', `/users/${viewer.user.id}/reset-name`, { reason: 'проверка' })
      .expect(409);
    expect(body.message).toMatch(/^Это учётная запись панели/);
  });
});

describe('отзывы в панели ведут к автору', () => {
  test('у отзыва есть author_id; просмотрщику — ни у видимого, ни у скрытого', async () => {
    const author = await person({ name: 'Автор Ссылки' });
    const { establishment } = await createPartnerWithEstablishment('active');
    await createTestReview(author.id, establishment.id, { rating: 5 });
    const other = (await createPartnerWithEstablishment('active')).establishment;
    await createTestReview(author.id, other.id, { rating: 1, is_visible: false });

    const asAdminList = await asAdmin('get', `/reviews?user_id=${author.id}`).expect(200);
    expect(asAdminList.body.data).toHaveLength(2);
    for (const review of asAdminList.body.data) expect(review.author_id).toBe(author.id);

    // По одному отзыву на заведение: выборка не зависит от чужих отзывов в базе.
    for (const place of [establishment.id, other.id]) {
      const { body } = await asViewer('get', `/reviews?establishment_id=${place}`).expect(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].author_id).toBeNull();
    }
  });
});

/*
 * Живая проверка Координатора 30.10.2026 не прошла: заблокировал тестовую
 * учётную запись в панели, на сайте нажал F5 на «Профиле» — обычная форма
 * входа, без слов «учётная запись отключена» и адреса поддержки. Причина:
 * блокировка не только выключает учётную запись, но и завершает все её
 * сеансы (endAllAccess), а обновление сеанса проверяло «сеансы завершены»
 * раньше, чем «выключена», и отвечало 401 TOKEN_REVOKED. Сайт и приложение
 * называют причину только на ACCOUNT_INACTIVE. Здесь — тот же путь: блокировка
 * из панели, затем то, что делают сайт и приложение при обновлении страницы.
 */
describe('заблокирован из панели — обновление страницы называет причину', () => {
  test('ключ доступа и обновление сеанса — 401 ACCOUNT_INACTIVE со словами сервера и адресом поддержки', async () => {
    const blocked = await person({ name: 'Проверка Блокировки' });
    // Открытый «Профиль»: сеанс живой, статус учётной записи в кэше.
    await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${blocked.accessToken}`).expect(200);

    await asAdmin('post', `/users/${blocked.id}/block`, { reason: 'тест' }).expect(200);

    // F5: профиль с прежним ключом доступа…
    const me = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${blocked.accessToken}`).expect(401);
    expect(me.body.error.code).toBe('ACCOUNT_INACTIVE');

    // …затем обновление сеанса — по его коду сайт и приложение и пишут причину.
    const refresh = await request(app).post('/api/v1/auth/refresh')
      .send({ refreshToken: blocked.refreshToken }).expect(401);
    expect(refresh.body.error).toEqual({
      code: 'ACCOUNT_INACTIVE',
      message: AUTH_REFUSALS.accountInactive,
    });
    expect(refresh.body.error.message).toContain(SUPPORT_EMAIL);

    // Тот же токен ещё раз (вторая вкладка, повтор после обрыва связи) — та же
    // причина, а не тревога о краже токена.
    const again = await request(app).post('/api/v1/auth/refresh')
      .send({ refreshToken: blocked.refreshToken }).expect(401);
    expect(again.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});
