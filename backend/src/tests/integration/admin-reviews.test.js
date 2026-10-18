/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Reviews Management Integration Tests
 *
 * Tests review management endpoints (Segment B — Phase 2):
 *   #14 GET  /api/v1/admin/reviews                    — all reviews (admin view)
 *   #15 POST /api/v1/admin/reviews/:id/visibility        — set visibility { is_visible }
 *   #16 POST /api/v1/admin/reviews/:id/delete          — soft delete
 *
 * Setup strategy:
 *   beforeAll  — create admin user, reviewer user, active establishment (shared)
 *   beforeEach — truncate reviews + audit_log (each test starts with clean review state)
 *   afterAll   — clearAllData()
 *
 * Notes:
 *   - Admin sees ALL reviews including is_visible=false and is_deleted=true
 *   - visibility uses WHERE is_deleted=false — deleted reviews return 404
 *   - delete is soft (is_deleted=true) — record remains in DB
 *   - Audit log writes are non-blocking (no await in service), but complete fast enough
 *     in test environment to be asserted without explicit delays
 *   - audit_log table is guaranteed deployed (Phase 0 migration)
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { setReviewVisibility } from '../../models/adminReviewModel.js';
import * as adminReviewService from '../../services/adminReviewService.js';
import {
  createAdminAndGetToken,
  createViewerAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
  checkAuditLogExists,
} from '../utils/adminTestHelpers.js';

let adminToken;
let reviewerUserId;
let reviewerEmail;
let testEstablishmentId;

beforeAll(async () => {
  // Admin for API calls
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;

  // Regular user as review author
  reviewerEmail = `reviewer-${randomUUID()}@test.com`;
  const reviewer = await createUserAndGetTokens({
    email: reviewerEmail,
    phone: null,
    password: 'User123!@#',
    name: 'Test Reviewer',
    role: 'user',
    authMethod: 'email',
  });
  reviewerUserId = reviewer.user.id;

  // Active establishment to attach reviews to
  const { establishment } = await createPartnerWithEstablishment('active');
  testEstablishmentId = establishment.id;
});

beforeEach(async () => {
  // Reset reviews and audit_log between tests; keep users and establishment
  await query('TRUNCATE TABLE audit_log CASCADE');
  await query('TRUNCATE TABLE reviews CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// #14 — GET /api/v1/admin/reviews
// ============================================================================

describe('GET /api/v1/admin/reviews (#14)', () => {
  test('should return empty list when no reviews exist', async () => {
    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  test('should return all reviews including hidden (is_visible=false)', async () => {
    await createTestReview(null, testEstablishmentId, { is_visible: true });
    await createTestReview(null, testEstablishmentId, { is_visible: false });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);
  });

  test('should return all reviews including deleted (is_deleted=true)', async () => {
    await createTestReview(null, testEstablishmentId, { is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(2);

    const hasDeleted = response.body.data.some(r => r.is_deleted === true);
    expect(hasDeleted).toBe(true);
  });

  test('should return expected fields for each review', async () => {
    await createTestReview(reviewerUserId, testEstablishmentId, { rating: 5 });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const review = response.body.data[0];

    // Core review fields
    expect(review.id).toBeDefined();
    expect(review.rating).toBe(5);
    expect(review.content).toBeDefined();
    expect(review.is_visible).toBeDefined();
    expect(review.is_deleted).toBeDefined();
    expect(review.created_at).toBeDefined();

    // Author info (from JOIN users)
    expect(review.author_name).toBeDefined();
    expect(review.author_email).toBeDefined();

    // Establishment info (from JOIN establishments)
    expect(review.establishment_name).toBeDefined();
    expect(review.establishment_id).toBe(testEstablishmentId);
  });

  test('should filter by status=visible (only not-deleted visible reviews)', async () => {
    await createTestReview(null, testEstablishmentId, { is_visible: true, is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_visible: false, is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews?status=visible')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].is_visible).toBe(true);
    expect(response.body.data[0].is_deleted).toBe(false);
  });

  test('should filter by status=hidden (not-deleted, not-visible)', async () => {
    await createTestReview(null, testEstablishmentId, { is_visible: true, is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_visible: false, is_deleted: false });

    const response = await request(app)
      .get('/api/v1/admin/reviews?status=hidden')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].is_visible).toBe(false);
    expect(response.body.data[0].is_deleted).toBe(false);
  });

  test('should filter by status=deleted', async () => {
    await createTestReview(null, testEstablishmentId, { is_deleted: false });
    await createTestReview(null, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews?status=deleted')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].is_deleted).toBe(true);
  });

  test('should support pagination', async () => {
    await createTestReview(null, testEstablishmentId);
    await createTestReview(null, testEstablishmentId);
    await createTestReview(null, testEstablishmentId);

    const response = await request(app)
      .get('/api/v1/admin/reviews?page=2&per_page=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.per_page).toBe(2);
    expect(response.body.data).toHaveLength(1); // 3 total, 2 on page 1, 1 on page 2
    expect(response.body.meta.total).toBe(3);
  });

  test('should require admin authentication', async () => {
    await request(app)
      .get('/api/v1/admin/reviews')
      .expect(401);
  });

  // The query the panel sends on opening the screen
  // (admin-web admin_review_service.dart getReviews: page + per_page), and
  // what AdminReviewItem.fromJson needs: id and created_at as strings,
  // author_name / author_email nullable — the panel shows the author by name.
  const PANEL_FIRST_PAGE = '/api/v1/admin/reviews?page=1&per_page=20';

  test('a viewer gets the list without the author e-mail; the name is still there', async () => {
    const viewer = await createViewerAndGetToken();
    await createTestReview(reviewerUserId, testEstablishmentId, { rating: 4 });

    const response = await request(app)
      .get(PANEL_FIRST_PAGE)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    const review = response.body.data[0];
    expect(typeof review.id).toBe('string');
    expect(typeof review.created_at).toBe('string');
    expect(review.author_name).toBe('Test Reviewer');
    expect(review).toHaveProperty('author_email', null);
    expect(JSON.stringify(response.body)).not.toContain(reviewerEmail);
  });

  test('an admin still gets the author e-mail', async () => {
    await createTestReview(reviewerUserId, testEstablishmentId, { rating: 4 });

    const response = await request(app)
      .get(PANEL_FIRST_PAGE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data[0].author_email).toBe(reviewerEmail);
  });
});

// ============================================================================
// Просмотрщик видит отзывы как посторонний, без людей (пакет 2, пункт 1;
// заход 2А облачного критика, B-1)
// ============================================================================
//
// Роль «только просмотр» показывают людям вне проекта. Отзыв, удалённый
// автором (или модератором), ей не отдаётся вовсе; скрытый модератором —
// отдаётся с пометкой «скрыт» (is_visible: false), но без имени, почты,
// статистики автора и без текста: скрытие часто и случается из-за того, что
// в тексте есть лишнее о людях. Выборка «все отзывы одного человека»
// просмотрщику закрыта. Администратору — как прежде.

describe('GET /api/v1/admin/reviews — проекция просмотрщика (пакет 2, п. 1)', () => {
  // Метки уникальны на прогон: проверка «не встречается нигде в ответе»
  // имеет смысл, только если строку нельзя случайно встретить в чужом поле.
  const HIDDEN_TEXT = `скрытый-текст-${randomUUID()}`;
  const DELETED_TEXT = `удалённый-текст-${randomUUID()}`;
  const HIDDEN_RESPONSE = `ответ-на-скрытый-${randomUUID()}`;

  let viewerToken;
  let hiddenAuthor;
  let deletedAuthor;

  // Почту база хранит в нижнем регистре — метка латиницей и строчными.
  const createNamedAuthor = async (label, emailLabel) => {
    const email = `${emailLabel}-${randomUUID()}@test.com`;
    const name = `${label} ${randomUUID().slice(0, 8)}`;
    const created = await createUserAndGetTokens({
      email,
      phone: null,
      password: 'User123!@#',
      name,
      role: 'user',
      authMethod: 'email',
    });
    return { id: created.user.id, email, name };
  };

  beforeAll(async () => {
    // Свой просмотрщик с уникальной почтой: фикстурный viewer@test.com уже
    // заводит тест выше, а таблица users между тестами не очищается.
    viewerToken = (await createUserAndGetTokens({
      email: `viewer-pack2-${randomUUID()}@test.com`,
      phone: null,
      password: 'Viewer123!@#',
      name: 'Pack2 Viewer',
      role: 'viewer',
      authMethod: 'email',
    })).accessToken;
    hiddenAuthor = await createNamedAuthor('Автор-скрытого', 'hidden-author');
    deletedAuthor = await createNamedAuthor('Автор-удалённого', 'deleted-author');
  });

  const seedThree = async () => {
    const visible = await createTestReview(reviewerUserId, testEstablishmentId, { rating: 5 });
    const hidden = await createTestReview(hiddenAuthor.id, testEstablishmentId, {
      rating: 1,
      content: HIDDEN_TEXT,
      is_visible: false,
      partner_response: HIDDEN_RESPONSE,
    });
    const deleted = await createTestReview(deletedAuthor.id, testEstablishmentId, {
      rating: 2,
      content: DELETED_TEXT,
      is_deleted: true,
    });
    return { visible, hidden, deleted };
  };

  const asViewer = (url) => request(app).get(url).set('Authorization', `Bearer ${viewerToken}`);
  const asAdmin = (url) => request(app).get(url).set('Authorization', `Bearer ${adminToken}`);

  test('удалённый отзыв просмотрщику не отдаётся вовсе — ни в списке, ни в счётчике', async () => {
    const { visible, hidden, deleted } = await seedThree();

    const response = await asViewer('/api/v1/admin/reviews?page=1&per_page=20').expect(200);

    const ids = response.body.data.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([visible.id, hidden.id]));
    expect(ids).not.toContain(deleted.id);
    expect(response.body.meta.total).toBe(2);
    expect(JSON.stringify(response.body)).not.toContain(DELETED_TEXT);
    expect(JSON.stringify(response.body)).not.toContain(deletedAuthor.name);
  });

  test('фильтр «Удалённые» просмотрщику пуст', async () => {
    await seedThree();

    const response = await asViewer('/api/v1/admin/reviews?status=deleted').expect(200);

    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  test('скрытый отзыв — с пометкой «скрыт», но без автора, его признаков и текста', async () => {
    const { hidden } = await seedThree();

    const response = await asViewer('/api/v1/admin/reviews?status=hidden').expect(200);

    expect(response.body.data).toHaveLength(1);
    const row = response.body.data[0];
    expect(row.id).toBe(hidden.id);
    expect(row.is_visible).toBe(false);
    expect(row.is_deleted).toBe(false);
    expect(row.rating).toBe(1);
    expect(row).toHaveProperty('author_name', null);
    expect(row).toHaveProperty('author_email', null);
    expect(row).toHaveProperty('author_review_count', null);
    expect(row).toHaveProperty('author_average_rating', null);
    expect(row).toHaveProperty('content', null);
    expect(row).toHaveProperty('partner_response', null);
    // Пустые поля — скрыты, а не отсутствуют: панель пишет «Скрыто в режиме
    // просмотра», а не «отзыв без текста».
    expect(row).toHaveProperty('viewer_redacted', true);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(hiddenAuthor.name);
    expect(body).not.toContain(hiddenAuthor.email);
    expect(body).not.toContain(HIDDEN_TEXT);
    expect(body).not.toContain(HIDDEN_RESPONSE);
  });

  test('видимый отзыв просмотрщик видит как посторонний: имя и текст есть, почты нет', async () => {
    const { visible } = await seedThree();

    const response = await asViewer('/api/v1/admin/reviews?status=visible').expect(200);

    const row = response.body.data.find((r) => r.id === visible.id);
    expect(row.author_name).toBe('Test Reviewer');
    expect(row.content).toBe('Test review content for admin testing');
    expect(row).toHaveProperty('author_email', null);
    expect(row).toHaveProperty('viewer_redacted', false);
  });

  test('выборка «все отзывы человека» просмотрщику отвергается', async () => {
    await seedThree();

    const response = await asViewer(`/api/v1/admin/reviews?user_id=${hiddenAuthor.id}`).expect(403);

    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain(HIDDEN_TEXT);
  });

  test('поиск по тексту не находит скрытый отзыв просмотрщику (иначе текст угадывается по совпадениям)', async () => {
    await seedThree();

    const response = await asViewer(
      `/api/v1/admin/reviews?search=${encodeURIComponent(HIDDEN_TEXT.slice(0, 20))}`,
    ).expect(200);

    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  test('статистика автора у видимого отзыва не выдаёт его скрытые (ревью Phase 3.5)', async () => {
    // Иначе разница «отзывов у автора» и его видимых строк называет число
    // скрытых, а список скрытых — их оценку, заведение и дату: скрытый отзыв
    // связывается с именем автора.
    const other = await createPartnerWithEstablishment('active');
    const author = await createNamedAuthor('Автор-двух', 'two-reviews-author');
    await createTestReview(author.id, testEstablishmentId, { rating: 5 });
    await createTestReview(author.id, other.establishment.id, { rating: 1, is_visible: false });

    const viewer = await asViewer('/api/v1/admin/reviews?status=visible').expect(200);
    const row = viewer.body.data.find((r) => r.author_name === author.name);
    expect(row.author_review_count).toBe(1);
    expect(row.author_average_rating).toBe(5);

    const admin = await asAdmin('/api/v1/admin/reviews?status=visible').expect(200);
    const adminRow = admin.body.data.find((r) => r.author_name === author.name);
    expect(adminRow.author_review_count).toBe(2);
    expect(adminRow.author_average_rating).toBe(3);
  });

  test('сервис сам, без общего слоя, отдаёт просмотрщику отзыв без почты автора', async () => {
    // Два слоя — у каждого свой свидетель: общий слой (projections/
    // viewerProjection.js) почту тоже гасит, и тест маршрута её не отличит.
    await seedThree();

    const { reviews } = await adminReviewService.getReviews({ viewer: true });

    expect(reviews.length).toBe(2);
    for (const review of reviews) {
      expect(review.author_email).toBeNull();
    }
  });

  test('администратору — как прежде: удалённые и скрытые с автором и текстом, фильтр по человеку работает', async () => {
    const { hidden, deleted } = await seedThree();

    const all = await asAdmin('/api/v1/admin/reviews?page=1&per_page=20').expect(200);
    expect(all.body.meta.total).toBe(3);
    const hiddenRow = all.body.data.find((r) => r.id === hidden.id);
    expect(hiddenRow.author_name).toBe(hiddenAuthor.name);
    expect(hiddenRow.author_email).toBe(hiddenAuthor.email);
    expect(hiddenRow.content).toBe(HIDDEN_TEXT);
    expect(hiddenRow.partner_response).toBe(HIDDEN_RESPONSE);
    expect(all.body.data.find((r) => r.id === deleted.id).content).toBe(DELETED_TEXT);

    const byPerson = await asAdmin(`/api/v1/admin/reviews?user_id=${hiddenAuthor.id}`).expect(200);
    expect(byPerson.body.data.map((r) => r.id)).toEqual([hidden.id]);

    const search = await asAdmin(
      `/api/v1/admin/reviews?search=${encodeURIComponent(HIDDEN_TEXT.slice(0, 20))}`,
    ).expect(200);
    expect(search.body.data.map((r) => r.id)).toEqual([hidden.id]);
  });
});

// ============================================================================
// #15 — POST /api/v1/admin/reviews/:id/visibility  { is_visible }
// ============================================================================
//
// Состояние задаётся явно, а не переключается: панель повторяет запрос при
// 5xx, и повтор «скрыть» обязан оставить отзыв скрытым (пакет 1 находок
// критиков, пункт 2 — Codex C-10). Прежний путь /toggle-visibility — псевдоним
// с тем же договором.

describe('POST /api/v1/admin/reviews/:id/visibility (#15)', () => {
  const setVisibility = (reviewId, body, path = 'visibility') => request(app)
    .post(`/api/v1/admin/reviews/${reviewId}/${path}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  const visibilityInDb = async (reviewId) =>
    (await query('SELECT is_visible FROM reviews WHERE id = $1', [reviewId])).rows[0].is_visible;

  test('«скрыть» видимый отзыв: is_visible true → false, changed: true', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    const response = await setVisibility(review.id, { is_visible: false }).expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(review.id);
    expect(response.body.data.is_visible).toBe(false);
    expect(response.body.data.changed).toBe(true);
    expect(await visibilityInDb(review.id)).toBe(false);
  });

  test('«показать» скрытый отзыв: is_visible false → true', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: false });

    const response = await setVisibility(review.id, { is_visible: true }).expect(200);

    expect(response.body.data.is_visible).toBe(true);
    expect(response.body.data.changed).toBe(true);
    expect(await visibilityInDb(review.id)).toBe(true);
  });

  test('дважды присланное «скрыть» оставляет отзыв скрытым и не пишет второй записи в журнал', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    await setVisibility(review.id, { is_visible: false }).expect(200);
    const repeat = await setVisibility(review.id, { is_visible: false }).expect(200);

    expect(repeat.body.data.is_visible).toBe(false);
    expect(repeat.body.data.changed).toBe(false);
    expect(await visibilityInDb(review.id)).toBe(false);

    const { rows } = await query(
      "SELECT action FROM audit_log WHERE entity_id = $1 AND action IN ('review_hide', 'review_show')",
      [review.id],
    );
    expect(rows).toEqual([{ action: 'review_hide' }]);
  });

  test('тот же договор по прежнему пути /toggle-visibility', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    await setVisibility(review.id, { is_visible: false }, 'toggle-visibility').expect(200);
    await setVisibility(review.id, { is_visible: false }, 'toggle-visibility').expect(200);

    expect(await visibilityInDb(review.id)).toBe(false);
  });

  test.each([
    ['без тела', undefined],
    ['is_visible строкой', { is_visible: 'false' }],
    ['is_visible null', { is_visible: null }],
  ])('без явного состояния — 422, отзыв не тронут: %s', async (_label, body) => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    const response = await setVisibility(review.id, body).expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await visibilityInDb(review.id)).toBe(true);
  });

  test('скрытый отзыв виден в списке со status=hidden', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    await setVisibility(review.id, { is_visible: false }).expect(200);

    const listResponse = await request(app)
      .get(`/api/v1/admin/reviews?status=hidden`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const hidden = listResponse.body.data.find(r => r.id === review.id);
    expect(hidden).toBeDefined();
    expect(hidden.is_visible).toBe(false);
  });

  test('should return 404 REVIEW_NOT_FOUND for non-existent UUID', async () => {
    const response = await setVisibility('00000000-0000-0000-0000-000000000000', { is_visible: false })
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  test('should return 404 for a deleted review', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_deleted: true });

    const response = await setVisibility(review.id, { is_visible: false }).expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  test('should return 422 for invalid UUID format', async () => {
    const response = await setVisibility('not-a-uuid', { is_visible: false });

    expect(response.body.success).toBe(false);
    expect(response.status).toBe(422);
  });

  test('should create audit_log entry with review_hide action when hiding', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    await setVisibility(review.id, { is_visible: false }).expect(200);

    const auditExists = await checkAuditLogExists(review.id, 'review_hide');
    expect(auditExists).toBe(true);
  });

  test('should create audit_log entry with review_show action when showing', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: false });

    await setVisibility(review.id, { is_visible: true }).expect(200);

    const auditExists = await checkAuditLogExists(review.id, 'review_show');
    expect(auditExists).toBe(true);
  });

  test('скрыть, затем показать — исходное состояние восстановлено', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: true });

    await setVisibility(review.id, { is_visible: false }).expect(200);
    const shown = await setVisibility(review.id, { is_visible: true }).expect(200);

    expect(shown.body.data.is_visible).toBe(true);
  });

  // Модель пишет запрошенное значение, а не противоположное текущему, и
  // только если состояние то, на котором принималось решение — иначе
  // параллельная правка перезаписывалась бы молча.
  test('модель: явное значение под охраной прежнего состояния', async () => {
    const hidden = await createTestReview(reviewerUserId, testEstablishmentId, { is_visible: false });

    // Решение «скрыть», принятое на скрытом: писать нечего, строка не меняется.
    expect(await setReviewVisibility(hidden.id, false, false)).toMatchObject({ id: hidden.id, is_visible: false });
    expect(await visibilityInDb(hidden.id)).toBe(false);

    // Решение, принятое на видимом, а отзыв уже скрыт: охранник не пропускает.
    expect(await setReviewVisibility(hidden.id, false, true)).toBeNull();
    expect(await visibilityInDb(hidden.id)).toBe(false);

    // Решение «показать» на скрытом — пишется.
    expect(await setReviewVisibility(hidden.id, true, false)).toMatchObject({ id: hidden.id, is_visible: true });
    expect(await visibilityInDb(hidden.id)).toBe(true);
  });

  test('should require admin authentication', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/visibility`)
      .send({ is_visible: false })
      .expect(401);
  });
});

// ============================================================================
// #16 — POST /api/v1/admin/reviews/:id/delete
// ============================================================================

describe('POST /api/v1/admin/reviews/:id/delete (#16)', () => {
  test('should soft-delete review — row remains in DB with is_deleted=true', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toBe('Review deleted successfully');

    // Verify row still exists in DB with is_deleted=true
    const dbResult = await query('SELECT id, is_deleted FROM reviews WHERE id = $1', [review.id]);
    expect(dbResult.rows).toHaveLength(1);
    expect(dbResult.rows[0].is_deleted).toBe(true);
  });

  test('should still return deleted review in GET /admin/reviews (admin sees all)', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Admin list should still show it
    const listResponse = await request(app)
      .get('/api/v1/admin/reviews?status=deleted')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const deletedReview = listResponse.body.data.find(r => r.id === review.id);
    expect(deletedReview).toBeDefined();
    expect(deletedReview.is_deleted).toBe(true);
  });

  test('should return 400 REVIEW_ALREADY_DELETED when deleting an already-deleted review', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId, { is_deleted: true });

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_ALREADY_DELETED');
  });

  test('should return 404 REVIEW_NOT_FOUND for non-existent UUID', async () => {
    const response = await request(app)
      .post('/api/v1/admin/reviews/00000000-0000-0000-0000-000000000000/delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  test('should return error for invalid UUID format', async () => {
    const response = await request(app)
      .post('/api/v1/admin/reviews/not-a-uuid/delete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.body.success).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test('should create audit_log entry with review_delete action', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditExists = await checkAuditLogExists(review.id, 'review_delete');
    expect(auditExists).toBe(true);
  });

  test('should accept optional reason body field without error', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Violates community guidelines' })
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  test('should work without reason field (reason is optional)', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    const response = await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  test('should require admin authentication', async () => {
    const review = await createTestReview(reviewerUserId, testEstablishmentId);

    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/delete`)
      .expect(401);
  });
});

// ============================================================================
// #17 — Aggregate recalculation on visibility toggle
// ============================================================================

describe('Aggregate recalculation on visibility change (#17)', () => {
  test('hiding a 1-star review should exclude it from average_rating', async () => {
    // Create two reviews: 5-star + 1-star → average = 3.00
    await createTestReview(null, testEstablishmentId, { rating: 5 });
    const lowReview = await createTestReview(null, testEstablishmentId, { rating: 1 });

    // Verify initial aggregates (trigger recalc via any toggle or direct query)
    let estRow = await query('SELECT average_rating, review_count FROM establishments WHERE id = $1', [testEstablishmentId]);
    // Note: createTestReview inserts directly — aggregates may be stale, so we use the toggle to trigger recalc

    // Hide the 1-star review → should recalculate to 5.00 / count=1
    await request(app)
      .post(`/api/v1/admin/reviews/${lowReview.id}/visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_visible: false })
      .expect(200);

    estRow = await query('SELECT average_rating, review_count FROM establishments WHERE id = $1', [testEstablishmentId]);
    expect(Number(estRow.rows[0].average_rating)).toBe(5);
    expect(Number(estRow.rows[0].review_count)).toBe(1);
  });

  test('showing (un-hiding) a review should include it back in aggregates', async () => {
    // Create 5-star visible + 3-star hidden
    await createTestReview(null, testEstablishmentId, { rating: 5, is_visible: true });
    const hiddenReview = await createTestReview(null, testEstablishmentId, { rating: 3, is_visible: false });

    // Un-hide the 3-star review → should recalculate to 4.00 / count=2
    await request(app)
      .post(`/api/v1/admin/reviews/${hiddenReview.id}/visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_visible: true })
      .expect(200);

    const estRow = await query('SELECT average_rating, review_count FROM establishments WHERE id = $1', [testEstablishmentId]);
    expect(Number(estRow.rows[0].average_rating)).toBe(4);
    expect(Number(estRow.rows[0].review_count)).toBe(2);
  });

  test('deleting an already-hidden review should not double-count exclusion', async () => {
    // Create 5-star visible + 2-star hidden
    await createTestReview(null, testEstablishmentId, { rating: 5, is_visible: true });
    const hiddenReview = await createTestReview(null, testEstablishmentId, { rating: 2, is_visible: false });

    // Force initial aggregate recalc so hidden review is already excluded
    // Toggle a dummy action: hide then show the 5-star to trigger recalc
    // Simpler: just check after delete
    // Delete the hidden 2-star review
    await request(app)
      .post(`/api/v1/admin/reviews/${hiddenReview.id}/delete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Aggregates should be: only the 5-star visible review → avg=5.00, count=1
    const estRow = await query('SELECT average_rating, review_count FROM establishments WHERE id = $1', [testEstablishmentId]);
    expect(Number(estRow.rows[0].average_rating)).toBe(5);
    expect(Number(estRow.rows[0].review_count)).toBe(1);
  });
});

// ============================================================================
// Б3 — проекция и агрегаты для экрана «Отзывы» (кадр 07 редизайна)
// ============================================================================

describe('Б3: агрегаты выборки и статистика в проекции', () => {
  test('meta несёт число скрытых и среднюю оценку по той же выборке', async () => {
    await createTestReview(null, testEstablishmentId, { rating: 5 });
    await createTestReview(null, testEstablishmentId, { rating: 3 });
    await createTestReview(null, testEstablishmentId, { rating: 1, is_visible: false });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.total).toBe(3);
    expect(response.body.meta.hidden).toBe(1);
    // (5 + 3 + 1) / 3 — скрытые входят в среднюю ВЫБОРКИ: подпись описывает
    // то, что модератор видит в списке, а скрытые он видит. Это НЕ то же
    // самое, что рейтинг заведения: там скрытые исключены
    // (updateEstablishmentAggregates фильтрует is_visible = true).
    expect(response.body.meta.average_rating).toBeCloseTo(3, 2);
  });

  test('удалённый отзыв не портит среднюю', async () => {
    await createTestReview(null, testEstablishmentId, { rating: 4 });
    await createTestReview(null, testEstablishmentId, { rating: 1, is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.total).toBe(2);
    expect(response.body.meta.average_rating).toBeCloseTo(4, 2);
    // Удалённый — не скрытый: у него своя строка статуса на экране.
    expect(response.body.meta.hidden).toBe(0);
  });

  test('агрегаты считаются по отфильтрованному, а не по разделу', async () => {
    await createTestReview(null, testEstablishmentId, { rating: 5 });
    await createTestReview(null, testEstablishmentId, { rating: 2, is_visible: false });
    await createTestReview(null, testEstablishmentId, { rating: 1, is_visible: false });

    const response = await request(app)
      .get('/api/v1/admin/reviews?status=hidden')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Подпись «2 отзыва · 2 скрыто · средний 1,5» описывает то, что в списке.
    expect(response.body.meta.total).toBe(2);
    expect(response.body.meta.hidden).toBe(2);
    expect(response.body.meta.average_rating).toBeCloseTo(1.5, 2);
  });

  test('пустая выборка отдаёт нули, а среднюю — null, а не 0', async () => {
    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.total).toBe(0);
    expect(response.body.meta.hidden).toBe(0);
    // «0,0» под звездой читается как плохая оценка, а не как её отсутствие —
    // отличать эти случаи должен уже клиент, и для этого ему нужен null.
    expect(response.body.meta.average_rating).toBeNull();
  });

  test('числа приходят числами, а не строками NUMERIC', async () => {
    await createTestReview(null, testEstablishmentId, { rating: 4 });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // node-pg отдаёт NUMERIC СТРОКОЙ. Без каста в float8 клиент получил бы
    // "4.00" там, где ждёт число, и упал бы на разборе.
    expect(typeof response.body.meta.average_rating).toBe('number');
    expect(typeof response.body.data[0].establishment_average_rating).toBe('number');
    expect(typeof response.body.data[0].author_average_rating).toBe('number');
  });

  test('проекция несёт рейтинг заведения и статистику автора', async () => {
    const author = await createUserAndGetTokens({
      email: `stats-author-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Stats Author',
      role: 'user',
      authMethod: 'email',
    });

    const { establishment: second } = await createPartnerWithEstablishment('active');

    // Один автор, два заведения: 2 и 4 → его средняя 3,0 при двух отзывах.
    const target = await createTestReview(author.user.id, testEstablishmentId, { rating: 2 });
    await createTestReview(author.user.id, second.id, { rating: 4 });
    // Чужой отзыв тому же заведению — попадает в рейтинг заведения, но не в
    // статистику автора.
    await createTestReview(null, testEstablishmentId, { rating: 5 });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const row = response.body.data.find((r) => r.id === target.id);

    expect(row.author_review_count).toBe(2);
    expect(row.author_average_rating).toBeCloseTo(3, 2);
    // Рейтинг заведения — по обоим его отзывам: (2 + 5) / 2.
    expect(row.establishment_review_count).toBe(2);
    expect(row.establishment_average_rating).toBeCloseTo(3.5, 2);
    // Дата ответа партнёра приходила и раньше — клиент её просто не читал.
    expect(row).toHaveProperty('partner_response_at');
  });

  test('удалённые отзывы автора в его статистику не входят', async () => {
    const author = await createUserAndGetTokens({
      email: `deleted-stats-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Deleted Stats',
      role: 'user',
      authMethod: 'email',
    });
    const { establishment: second } = await createPartnerWithEstablishment('active');

    const target = await createTestReview(author.user.id, testEstablishmentId, { rating: 5 });
    await createTestReview(author.user.id, second.id, { rating: 1, is_deleted: true });

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const row = response.body.data.find((r) => r.id === target.id);
    expect(row.author_review_count).toBe(1);
    expect(row.author_average_rating).toBeCloseTo(5, 2);
  });

  test('метка создания отдаётся как UTC, а не как местное время процесса', async () => {
    const review = await createTestReview(null, testEstablishmentId, { rating: 4 });
    await query(
      "UPDATE reviews SET created_at = '2026-07-14 09:41:00' WHERE id = $1",
      [review.id],
    );

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Стенное время из БД читаем текстом: разбирать его тем же node-pg
    // значило бы сверять дефект с самим собой.
    const stored = await query(
      "SELECT to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') as wall FROM reviews WHERE id = $1",
      [review.id],
    );

    // ЧЕСТНАЯ ГРАНИЦА: на UTC-раннере этот тест зелёный и БЕЗ правки — дефект
    // по построению невидим там, где процесс живёт в UTC. Он краснеет на
    // машине разработчика (UTC+3) и сторожит смысл: метка на проводе — это
    // ровно то, что лежит в колонке, а не то же самое минус часовой пояс
    // того, кто её прочитал.
    expect(response.body.data[0].created_at).toBe(`${stored.rows[0].wall}.000Z`);
  });
});

describe('Б3: чей рейтинг заведения попадает в проекцию', () => {
  test('скрытый отзыв выпадает из рейтинга заведения — пишет не триггер', async () => {
    // Посылка, на которой стоит клиентский расчёт «без этого отзыва». Она НЕ
    // очевидна: триггер update_metrics_after_review считает по всем
    // неудалённым, и по нему скрытый остался бы внутри. Но после триггера на
    // каждом пути записи вызывается updateEstablishmentAggregates, а она
    // фильтрует ещё и is_visible = true — её значение и остаётся в колонке.
    //
    // Без этого теста расхождение видно только в панели модератора, и то
    // числом, которое выглядит правдоподобно.
    await createTestReview(null, testEstablishmentId, { rating: 5 });
    await createTestReview(null, testEstablishmentId, { rating: 5 });
    const toHide = await createTestReview(null, testEstablishmentId, { rating: 1 });

    await request(app)
      .post(`/api/v1/admin/reviews/${toHide.id}/visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_visible: false })
      .expect(200);

    const response = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const hidden = response.body.data.find((r) => r.id === toHide.id);

    expect(hidden.is_visible).toBe(false);
    // Единица исключена: две видимые пятёрки дают 5,00 при двух отзывах.
    expect(hidden.establishment_average_rating).toBeCloseTo(5, 2);
    expect(hidden.establishment_review_count).toBe(2);
    // Если бы скрытый считался, вышло бы 3,67 при трёх отзывах — и клиент,
    // вычитая единицу из тройки, получил бы 5,00 вместо честного «ничего не
    // изменится». Совпадение здесь означает, что вычитать нечего.
  });
});

// ============================================================================
// The entry of a one-by-one hide is written with the hide, or neither is
// ============================================================================

describe('setVisibility: the journal entry is part of the change', () => {
  const adminId = async () => (await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")).rows[0].id;

  test('an entry that cannot be written fails the hide: the review stays visible, the rating untouched', async () => {
    const review = await createTestReview(null, testEstablishmentId, { rating: 1 });
    const before = (await query('SELECT average_rating, review_count FROM establishments WHERE id = $1', [testEstablishmentId])).rows[0];

    // ip_address is INET: this value makes the INSERT into audit_log fail.
    await expect(adminReviewService.setVisibility(review.id, false, await adminId(), { ipAddress: 'not-an-address' }))
      .rejects.toMatchObject({ statusCode: 500, code: 'VISIBILITY_UPDATE_FAILED' });

    const stored = (await query('SELECT is_visible FROM reviews WHERE id = $1', [review.id])).rows[0];
    expect(stored.is_visible).toBe(true);
    expect(await checkAuditLogExists(review.id, 'review_hide')).toBe(false);
    const after = (await query('SELECT average_rating, review_count FROM establishments WHERE id = $1', [testEstablishmentId])).rows[0];
    expect(after).toEqual(before);
  });

  test('a hide that succeeds has its entry, timed by the moment of the write', async () => {
    const review = await createTestReview(null, testEstablishmentId);
    const result = await adminReviewService.setVisibility(review.id, false, await adminId(), { ipAddress: '127.0.0.1' });
    expect(result).toMatchObject({ is_visible: false, changed: true });

    const entry = (await query(
      `SELECT new_data, ip_address::text AS ip FROM audit_log WHERE entity_id = $1 AND action = 'review_hide'`,
      [review.id],
    )).rows;
    expect(entry).toHaveLength(1);
    expect(entry[0].new_data).toEqual({ is_visible: false });
    expect(entry[0].ip).toBe('127.0.0.1/32');
  });
});
