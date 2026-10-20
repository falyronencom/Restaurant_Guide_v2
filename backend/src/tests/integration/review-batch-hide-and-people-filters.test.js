/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Отзывы и люди в панели — проход по панели модератора, 20.10, пакет П7.
 *
 * Отзывы: скрыть разом выбранные отзывы одного человека с одной причиной
 * (A2-09) — по записи review_hide в журнал на каждый отзыв; фильтр по
 * диапазону оценок (ссылка из аналитики «оценка 1–2», осмотр 20.10 п. 31);
 * почему скрыт отзыв и заблокирован ли автор (A2-11); причина скрытия и предел
 * причины удаления (A2-12); русские отказы (A2-02); «%» и «_» в поиске — сами
 * себя (A2-20).
 *
 * Люди: удалённая учётка — не «заблокированная» (A2-05); история блокировок
 * с причинами (A2-15, п. 35); карточки партнёра (п. 35); фильтр по роли;
 * разблокировка говорит, сколько отзывов вернула из скольких (A2-06).
 *
 * На старом коде красные все, кроме проверок, что старое поведение осталось:
 * маршрута hide-batch, полей и фильтров не было, тексты были английскими.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createViewerAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
} from '../utils/adminTestHelpers.js';

const ADMIN = '/api/v1/admin';
const CYRILLIC = /[А-Яа-яЁё]/;

/** Текст отказа — в конверте сервера он в message. */
const refusalText = (response) => response.body.error?.message ?? response.body.message;

let admin;
let viewer;
let establishmentId;
let secondEstablishmentId;

const asAdmin = (method, url, body) => request(app)[method](`${ADMIN}${url}`)
  .set('Authorization', `Bearer ${admin.accessToken}`)
  .send(body);

const asViewer = (method, url, body) => request(app)[method](`${ADMIN}${url}`)
  .set('Authorization', `Bearer ${viewer.accessToken}`)
  .send(body);

const person = async ({ name = 'Пётр Тестов', role = 'user' } = {}) => {
  const created = await createUserAndGetTokens({
    email: `p7-${randomUUID()}@test.com`,
    phone: null,
    password: 'Person123!@#',
    name,
    role,
    authMethod: 'email',
  });
  return { ...created, id: created.user.id };
};

const reviewRow = async (id) => (await query(
  'SELECT is_visible, is_deleted FROM reviews WHERE id = $1', [id],
)).rows[0];

const reviewJournal = async (reviewId) => (await query(
  `SELECT user_id, action, new_data FROM audit_log
   WHERE entity_type = 'review' AND entity_id = $1 ORDER BY created_at`,
  [reviewId],
)).rows;

beforeAll(async () => {
  admin = await createAdminAndGetToken();
  viewer = await createViewerAndGetToken();
  establishmentId = (await createPartnerWithEstablishment('active')).establishment.id;
  secondEstablishmentId = (await createPartnerWithEstablishment('active')).establishment.id;
});

beforeEach(async () => {
  await query('TRUNCATE TABLE audit_log CASCADE');
  await query('TRUNCATE TABLE reviews CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Скрыть выбранные разом
// ============================================================================

describe('POST /admin/reviews/hide-batch — отзывы одного человека разом (A2-09)', () => {
  test('видимые скрываются, уже скрытые пропускаются; по записи review_hide на отзыв с общей пачкой и причиной', async () => {
    const tester = await person({ name: 'Тестировщик' });
    const a = await createTestReview(tester.id, establishmentId, { rating: 1 });
    const b = await createTestReview(tester.id, secondEstablishmentId, { rating: 2 });
    const alreadyHidden = await createTestReview(null, establishmentId, { is_visible: false });
    const bystander = await createTestReview(null, establishmentId, { rating: 5 });

    const response = await asAdmin('post', '/reviews/hide-batch', {
      review_ids: [a.id, b.id, alreadyHidden.id],
      reason: 'Тестовые отзывы стороннего тестировщика',
    }).expect(200);

    expect(response.body.data).toMatchObject({
      requested: 3, hidden: 2, skipped: 1, changed: true,
    });
    expect(response.body.data.hidden_ids.sort()).toEqual([a.id, b.id].sort());
    expect((await reviewRow(a.id)).is_visible).toBe(false);
    expect((await reviewRow(b.id)).is_visible).toBe(false);
    expect((await reviewRow(bystander.id)).is_visible).toBe(true);

    const [entryA] = await reviewJournal(a.id);
    const [entryB] = await reviewJournal(b.id);
    expect(entryA.action).toBe('review_hide');
    expect(entryA.user_id).toBe(admin.user.id);
    expect(entryA.new_data).toMatchObject({
      is_visible: false,
      reason: 'Тестовые отзывы стороннего тестировщика',
      batch_size: 2,
    });
    expect(entryA.new_data.batch_id).toBe(entryB.new_data.batch_id);
    expect(await reviewJournal(alreadyHidden.id)).toHaveLength(0);
  });

  test('рейтинг каждого заведения пересчитан без скрытых', async () => {
    const tester = await person();
    const low = await createTestReview(tester.id, establishmentId, { rating: 1 });
    await createTestReview(null, establishmentId, { rating: 5 });
    await asAdmin('post', `/reviews/${low.id}/visibility`, { is_visible: true }); // пересчёт до

    await asAdmin('post', '/reviews/hide-batch', {
      review_ids: [low.id], reason: 'тест',
    }).expect(200);

    const { rows } = await query(
      'SELECT average_rating::float8 AS avg, review_count FROM establishments WHERE id = $1',
      [establishmentId],
    );
    expect(rows[0].avg).toBe(5);
    expect(rows[0].review_count).toBe(1);
  });

  test('повтор той же пачки ничего не меняет и в журнал не пишет', async () => {
    const r = await createTestReview(null, establishmentId);
    await asAdmin('post', '/reviews/hide-batch', { review_ids: [r.id], reason: 'тест' }).expect(200);
    const again = await asAdmin('post', '/reviews/hide-batch', { review_ids: [r.id], reason: 'тест' }).expect(200);

    expect(again.body.data).toMatchObject({ hidden: 0, skipped: 1, changed: false });
    expect(await reviewJournal(r.id)).toHaveLength(1);
  });

  test.each([
    ['пустой список', { review_ids: [], reason: 'тест' }, 'BATCH_EMPTY'],
    ['не список', { review_ids: 'abc', reason: 'тест' }, 'BATCH_EMPTY'],
    ['неверный id', { review_ids: ['not-a-uuid'], reason: 'тест' }, 'BATCH_INVALID_ID'],
    ['без причины', { review_ids: [randomUUID()] }, 'REASON_REQUIRED'],
    ['причина из пробелов', { review_ids: [randomUUID()], reason: '   ' }, 'REASON_REQUIRED'],
    ['причина длиннее 500', { review_ids: [randomUUID()], reason: 'я'.repeat(501) }, 'REASON_TOO_LONG'],
    ['больше 100 отзывов', { review_ids: Array.from({ length: 101 }, () => randomUUID()), reason: 'тест' }, 'BATCH_TOO_LARGE'],
  ])('%s — 422 с русским текстом', async (_label, body, code) => {
    const response = await asAdmin('post', '/reviews/hide-batch', body).expect(422);
    expect(response.body.error.code).toBe(code);
    expect(refusalText(response)).toMatch(CYRILLIC);
  });

  test('просмотрщику — отказ, отзыв не тронут', async () => {
    const r = await createTestReview(null, establishmentId);
    await asViewer('post', '/reviews/hide-batch', { review_ids: [r.id], reason: 'тест' }).expect(403);
    expect((await reviewRow(r.id)).is_visible).toBe(true);
  });
});

// ============================================================================
// Причина скрытия и удаления, русские отказы
// ============================================================================

describe('Причина скрытия и удаления (A2-12), русские отказы (A2-02)', () => {
  test('скрытие с причиной пишет её в журнал; без причины — как прежде', async () => {
    const withReason = await createTestReview(null, establishmentId);
    const without = await createTestReview(null, establishmentId);

    await asAdmin('post', `/reviews/${withReason.id}/visibility`, {
      is_visible: false, reason: '  Реклама  ',
    }).expect(200);
    await asAdmin('post', `/reviews/${without.id}/visibility`, { is_visible: false }).expect(200);

    expect((await reviewJournal(withReason.id))[0].new_data).toEqual({ is_visible: false, reason: 'Реклама' });
    expect((await reviewJournal(without.id))[0].new_data).toEqual({ is_visible: false });
  });

  test('причина скрытия длиннее 500 — 422, отзыв виден', async () => {
    const r = await createTestReview(null, establishmentId);
    const response = await asAdmin('post', `/reviews/${r.id}/visibility`, {
      is_visible: false, reason: 'я'.repeat(501),
    }).expect(422);
    expect(response.body.error.code).toBe('REASON_TOO_LONG');
    expect((await reviewRow(r.id)).is_visible).toBe(true);
  });

  test('причина удаления длиннее 500 — 422, отзыв не удалён; 500 знаков — можно', async () => {
    const r = await createTestReview(null, establishmentId);
    const long = await asAdmin('post', `/reviews/${r.id}/delete`, { reason: 'я'.repeat(501) }).expect(422);
    expect(long.body.error.code).toBe('REASON_TOO_LONG');
    expect((await reviewRow(r.id)).is_deleted).toBe(false);

    await asAdmin('post', `/reviews/${r.id}/delete`, { reason: 'я'.repeat(500) }).expect(200);
    expect((await reviewRow(r.id)).is_deleted).toBe(true);
  });

  test('отказы действий над отзывами — по-русски, коды и статусы прежние', async () => {
    const deleted = await createTestReview(null, establishmentId, { is_deleted: true });
    const missing = randomUUID();

    const cases = [
      [await asAdmin('post', `/reviews/${missing}/visibility`, { is_visible: false }), 404, 'REVIEW_NOT_FOUND'],
      [await asAdmin('post', `/reviews/${missing}/delete`, {}), 404, 'REVIEW_NOT_FOUND'],
      [await asAdmin('post', `/reviews/${deleted.id}/delete`, {}), 400, 'REVIEW_ALREADY_DELETED'],
      [await asAdmin('post', '/reviews/not-a-uuid/visibility', { is_visible: false }), 422, 'VALIDATION_ERROR'],
      [await asAdmin('post', `/reviews/${missing}/visibility`, {}), 422, 'VALIDATION_ERROR'],
      [await asAdmin('post', '/reviews/not-a-uuid/delete', {}), 422, 'VALIDATION_ERROR'],
      [await asViewer('get', `/reviews?user_id=${randomUUID()}`), 403, 'VIEWER_PERSON_FILTER_FORBIDDEN'],
    ];
    for (const [response, status, code] of cases) {
      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe(code);
      // Отказ проверки полей несёт текст сводкой (message) и по полям.
      expect(refusalText(response)).toMatch(CYRILLIC);
      for (const detail of response.body.error.details ?? []) {
        expect(detail.message).toMatch(CYRILLIC);
      }
    }
  });
});

// ============================================================================
// Фильтр по оценке, автору и поиск
// ============================================================================

describe('GET /admin/reviews — диапазон оценок, автор, поиск', () => {
  test('rating_min/rating_max — «оценка 1–2» из аналитики; счётчики по той же выборке', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      await createTestReview(null, establishmentId, { rating });
    }
    const response = await asAdmin('get', '/reviews?rating_min=1&rating_max=2').expect(200);

    expect(response.body.data.map((r) => r.rating).sort()).toEqual([1, 2]);
    expect(response.body.meta.total).toBe(2);
    expect(response.body.meta.average_rating).toBe(1.5);
  });

  test('одиночная оценка — как прежде', async () => {
    await createTestReview(null, establishmentId, { rating: 3 });
    await createTestReview(null, establishmentId, { rating: 4 });
    const response = await asAdmin('get', '/reviews?rating=3').expect(200);
    expect(response.body.data.map((r) => r.rating)).toEqual([3]);
  });

  test.each(['abc', '0', '6', '2.5'])('оценка «%s» — 422 по-русски, а не 500', async (value) => {
    const response = await asAdmin('get', `/reviews?rating_max=${value}`).expect(422);
    expect(response.body.error.code).toBe('RATING_FILTER_INVALID');
    expect(refusalText(response)).toMatch(CYRILLIC);
  });

  test('автор не uuid — 422 по-русски, а не 500', async () => {
    const response = await asAdmin('get', '/reviews?user_id=abc').expect(422);
    expect(response.body.error.code).toBe('AUTHOR_FILTER_INVALID');
  });

  test('«%» и «_» в поиске ищут сами себя (A2-20)', async () => {
    const percent = await createTestReview(null, establishmentId, { content: 'Скидка 100% на всё' });
    await createTestReview(null, establishmentId, { content: 'Скидка 1000 рублей' });
    const underscore = await createTestReview(null, establishmentId, { content: 'код a_b внутри' });
    await createTestReview(null, establishmentId, { content: 'код aXb внутри' });

    const byPercent = await asAdmin('get', `/reviews?search=${encodeURIComponent('100%')}`).expect(200);
    expect(byPercent.body.data.map((r) => r.id)).toEqual([percent.id]);

    const onlyPercent = await asAdmin('get', `/reviews?search=${encodeURIComponent('%')}`).expect(200);
    expect(onlyPercent.body.data.map((r) => r.id)).toEqual([percent.id]);

    const byUnderscore = await asAdmin('get', '/reviews?search=a_b').expect(200);
    expect(byUnderscore.body.data.map((r) => r.id)).toEqual([underscore.id]);
  });
});

// ============================================================================
// Почему скрыт, заблокирован ли автор
// ============================================================================

describe('Проекция отзыва: почему скрыт и заблокирован ли автор (A2-11)', () => {
  const findReview = async (id, as = asAdmin) => {
    const response = await as('get', '/reviews?per_page=50').expect(200);
    return response.body.data.find((r) => r.id === id);
  };

  test('скрыт модератором — с его причиной; скрыт блокировкой — «block» с причиной блокировки', async () => {
    const author = await person();
    const byModerator = await createTestReview(null, establishmentId);
    const byBlock = await createTestReview(author.id, establishmentId);

    await asAdmin('post', `/reviews/${byModerator.id}/visibility`, {
      is_visible: false, reason: 'Оскорбления',
    }).expect(200);
    await asAdmin('post', `/users/${author.id}/block`, { reason: 'Накрутка' }).expect(200);

    expect(await findReview(byModerator.id)).toMatchObject({
      hidden_by: 'moderator', hidden_reason: 'Оскорбления', author_is_active: true,
    });
    expect(await findReview(byBlock.id)).toMatchObject({
      hidden_by: 'block', hidden_reason: 'Накрутка', author_is_active: false,
    });
  });

  test('показан и снова скрыт — побеждает последняя запись; видимый — без причины', async () => {
    const author = await person();
    const r = await createTestReview(author.id, establishmentId);
    await asAdmin('post', `/users/${author.id}/block`, { reason: 'Накрутка' }).expect(200);
    await asAdmin('post', `/reviews/${r.id}/visibility`, { is_visible: true }).expect(200);

    expect(await findReview(r.id)).toMatchObject({ hidden_by: null, hidden_reason: null, is_visible: true });

    await asAdmin('post', `/reviews/${r.id}/visibility`, { is_visible: false, reason: 'Повторно' }).expect(200);
    expect(await findReview(r.id)).toMatchObject({ hidden_by: 'moderator', hidden_reason: 'Повторно' });
  });

  test('скрыт без записи в журнале — причина не выдумывается', async () => {
    const r = await createTestReview(null, establishmentId, { is_visible: false });
    expect(await findReview(r.id)).toMatchObject({ hidden_by: null, hidden_reason: null });
  });

  test('просмотрщику ни причины, ни состояния автора', async () => {
    const author = await person();
    const visible = await createTestReview(author.id, establishmentId);
    const hidden = await createTestReview(null, secondEstablishmentId);
    await asAdmin('post', `/reviews/${hidden.id}/visibility`, { is_visible: false, reason: 'Оскорбления' }).expect(200);

    expect(await findReview(visible.id, asViewer)).toMatchObject({ author_is_active: null, hidden_reason: null });
    expect(await findReview(hidden.id, asViewer)).toMatchObject({
      author_is_active: null, hidden_by: null, hidden_reason: null,
    });
  });
});

// ============================================================================
// Люди
// ============================================================================

describe('«Пользователи»: удалённая учётка, роль, история блокировок', () => {
  const listIds = async (qs) => (await asAdmin('get', `/users?per_page=50&${qs}`).expect(200))
    .body.data.map((u) => u.id);

  test('удалённая учётка — is_deleted, не в «Заблокированных», а в «Удалённых» (A2-05)', async () => {
    const gone = await person();
    await request(app).delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${gone.accessToken}`)
      .send({ confirmation: 'УДАЛИТЬ' })
      .expect(200);
    const blocked = await person();
    await asAdmin('post', `/users/${blocked.id}/block`, { reason: 'Спам' }).expect(200);

    const blockedIds = await listIds('status=blocked');
    expect(blockedIds).toContain(blocked.id);
    expect(blockedIds).not.toContain(gone.id);
    expect(await listIds('status=deleted')).toEqual([gone.id]);

    const card = (await asAdmin('get', `/users/${gone.id}`).expect(200)).body.data;
    expect(card).toMatchObject({ is_deleted: true, is_active: false });
    const blockedCard = (await asAdmin('get', `/users/${blocked.id}`).expect(200)).body.data;
    expect(blockedCard.is_deleted).toBe(false);
  });

  test('фильтр по роли', async () => {
    const partner = await person({ role: 'partner' });
    const user = await person();
    const partners = await listIds('role=partner');
    expect(partners).toContain(partner.id);
    expect(partners).not.toContain(user.id);
    const users = await listIds('role=user');
    expect(users).toContain(user.id);
    expect(users).not.toContain(partner.id);
    expect(await listIds('role=panel')).toContain(admin.user.id);
  });

  test('«_» в поиске людей ищет само себя (A2-20)', async () => {
    const exact = await person({ name: `ivan_${randomUUID().slice(0, 6)}` });
    await person({ name: `ivanX${exact.user.name.slice(5)}` });
    expect(await listIds(`search=${encodeURIComponent(exact.user.name)}`)).toEqual([exact.id]);
  });

  test('история: блокировка и разблокировка с причинами, новые сверху; счёт отзывов (A2-15)', async () => {
    const someone = await person();
    await createTestReview(someone.id, establishmentId);
    await createTestReview(someone.id, secondEstablishmentId);
    await asAdmin('post', `/users/${someone.id}/block`, { reason: 'Накрутка отзывов' }).expect(200);
    const unblock = await asAdmin('post', `/users/${someone.id}/unblock`, {
      reason: 'Разобрались', restore_reviews: true,
    }).expect(200);

    expect(unblock.body.data).toMatchObject({
      restored_reviews: 2, block_hidden_reviews: 2, block_by_operator: false, block_found: true,
    });

    const card = (await asAdmin('get', `/users/${someone.id}`).expect(200)).body.data;
    expect(card.block_history.map((e) => [e.action, e.reason])).toEqual([
      ['user_unblock', 'Разобрались'],
      ['user_block', 'Накрутка отзывов'],
    ]);
    expect(card.block_history[1]).toMatchObject({ hidden_reviews: 2, by_operator: false });
    expect(card.block_history[0]).toMatchObject({ restored_reviews: 2 });
    expect(card.block_history[1].admin_name).toBeTruthy();
    // Прежнее поле — для старых сборок панели — на месте.
    expect(card.last_block_action.action).toBe('user_unblock');

    const asViewerCard = (await asViewer('get', `/users/${someone.id}`).expect(200)).body.data;
    expect(asViewerCard.block_history).toHaveLength(2);
    expect(asViewerCard.block_history.every((e) => e.reason === null && e.admin_name === null)).toBe(true);
  });

  test('блокировку ставил скрипт оператора — разблокировка так и говорит', async () => {
    const someone = await person();
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [someone.id]);
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, created_at)
       VALUES (NULL, 'user_block', 'user', $1, '{"is_active": true}',
               '{"is_active": false, "reason": "Учётку выключил оператор скриптом", "hidden_review_ids": [], "actor": "operator_script:set-user-active"}',
               clock_timestamp())`,
      [someone.id],
    );

    const unblock = await asAdmin('post', `/users/${someone.id}/unblock`, { reason: 'Вернули' }).expect(200);
    expect(unblock.body.data).toMatchObject({
      restored_reviews: 0, block_hidden_reviews: 0, block_by_operator: true, block_found: true,
    });
    const card = (await asAdmin('get', `/users/${someone.id}`).expect(200)).body.data;
    expect(card.block_history[1]).toMatchObject({ action: 'user_block', by_operator: true, admin_name: null });
  });

  test('у партнёра видны его карточки; просмотрщику — нет', async () => {
    const { partner, establishment } = await createPartnerWithEstablishment('pending');
    const card = (await asAdmin('get', `/users/${partner.user.id}`).expect(200)).body.data;
    expect(card.establishments).toEqual([
      expect.objectContaining({ id: establishment.id, name: establishment.name, status: 'pending' }),
    ]);
    const forViewer = (await asViewer('get', `/users/${partner.user.id}`).expect(200)).body.data;
    expect(forViewer.establishments).toBeNull();
  });
});
