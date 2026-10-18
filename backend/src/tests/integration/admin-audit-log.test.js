/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Audit Log Integration Tests
 *
 * Tests endpoint #17 (Segment C):
 *   GET /api/v1/admin/audit-log — paginated audit journal with filters
 *
 * Setup strategy: trigger real admin actions via HTTP (moderation + review
 * toggle), which write to audit_log non-blockingly. Then assert the
 * GET endpoint returns those entries correctly.
 *
 * Actions triggered in beforeAll:
 *   1. Approve establishment  → action='moderate_approve', entity_type='establishment'
 *   2. Reject establishment   → action='moderate_reject',  entity_type='establishment'
 *   3. Toggle review hidden   → action='review_hide',      entity_type='review'
 *
 * Response format (NOT the standard items/pagination format):
 *   { success: true, data: entries[], meta: { total, page, per_page, pages } }
 *
 * audit_log table confirmed deployed: setup.js TRUNCATES it in global setup.
 * Non-blocking write delay: 500ms after last action in beforeAll.
 *
 * Filters tested: action, entity_type, user_id, from/to date range, sort.
 * include_metadata: adds ip_address and user_agent columns to each entry.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
  createViewerAndGetToken,
} from '../utils/adminTestHelpers.js';
import * as EstablishmentModel from '../../models/establishmentModel.js';
import * as AuditLogModel from '../../models/auditLogModel.js';

const BASE_URL = '/api/v1/admin/audit-log';

let adminToken;
let adminUserId;
let viewerToken; // read-only panel role: sees the journal without metadata
let userToken; // non-admin, for 403 tests
let approvedEstablishmentId;
let rejectedEstablishmentId;
let testReviewId;

beforeAll(async () => {
  // Admin user
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
  adminUserId = admin.user.id;

  // Viewer user
  const viewer = await createViewerAndGetToken();
  viewerToken = viewer.accessToken;

  // Non-admin user for 403 assertions
  const regularUser = await createUserAndGetTokens({
    email: `audit-user-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: 'Audit Regular User',
    role: 'user',
    authMethod: 'email',
  });
  userToken = regularUser.accessToken;

  // ── Action 1: Approve an establishment ──────────────────────────────────
  const { establishment: est1 } = await createPartnerWithEstablishment('pending');
  approvedEstablishmentId = est1.id;

  await request(app)
    .post(`/api/v1/admin/establishments/${approvedEstablishmentId}/moderate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ action: 'approve' });

  // Tiny gap between actions to ensure distinct created_at timestamps
  await new Promise(r => setTimeout(r, 20));

  // ── Action 2: Reject an establishment ───────────────────────────────────
  const { establishment: est2 } = await createPartnerWithEstablishment('pending');
  rejectedEstablishmentId = est2.id;

  await request(app)
    .post(`/api/v1/admin/establishments/${rejectedEstablishmentId}/moderate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ action: 'reject', reason: 'Automated test rejection' });

  await new Promise(r => setTimeout(r, 20));

  // ── Action 3: Hide a review ─────────────────────────────────────────────
  // Need an active establishment to attach the review to
  const { establishment: activeEst } = await createPartnerWithEstablishment('active');
  const review = await createTestReview(null, activeEst.id, { rating: 4, is_visible: true });
  testReviewId = review.id;

  await request(app)
    .post(`/api/v1/admin/reviews/${testReviewId}/visibility`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ is_visible: false });

});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Auth guards
// ============================================================================

describe('Auth guards', () => {
  test('returns 401 without Authorization header', async () => {
    const res = await request(app).get(BASE_URL).expect(401);
    expect(res.body.success).toBe(false);
  });

  test('returns 403 for non-admin role', async () => {
    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(res.body.success).toBe(false);
  });
});

// ============================================================================
// Basic response structure
// ============================================================================

describe('GET /api/v1/admin/audit-log (#17) — basic response', () => {
  test('returns 200 with success: true', async () => {
    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('response has data array and meta object', async () => {
    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  test('meta object has total, page, per_page, pages', async () => {
    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.meta).toHaveProperty('total');
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('per_page');
    expect(body.meta).toHaveProperty('pages');
    expect(typeof body.meta.total).toBe('number');
    expect(body.meta.page).toBe(1); // default page
    expect(body.meta.per_page).toBe(20); // default per_page
  });

  test('returns audit log entries created by moderation actions', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.meta.total).toBeGreaterThanOrEqual(3); // approve + reject + review_hide
    expect(body.data.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// Entry schema
// ============================================================================

describe('GET /api/v1/admin/audit-log — entry schema', () => {
  test('each entry has required fields: id, action, entity_type, entity_id, created_at', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach(entry => {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('entity_type');
      expect(entry).toHaveProperty('entity_id');
      expect(entry).toHaveProperty('created_at');
    });
  });

  test('each entry has admin_name, admin_email (joined from users), and summary', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.forEach(entry => {
      expect(entry).toHaveProperty('admin_name');
      expect(entry).toHaveProperty('admin_email');
      expect(entry).toHaveProperty('summary');
    });
  });

  test('each entry has old_data and new_data (may be null)', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.forEach(entry => {
      expect(entry).toHaveProperty('old_data');
      expect(entry).toHaveProperty('new_data');
    });
  });

  test('without include_metadata — ip_address and user_agent are NOT in entries', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    // metadata columns should be absent by default
    body.data.forEach(entry => {
      expect(entry).not.toHaveProperty('ip_address');
      expect(entry).not.toHaveProperty('user_agent');
    });
  });

  test('?include_metadata=true — entries include ip_address and user_agent', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?include_metadata=true`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach(entry => {
      expect(entry).toHaveProperty('ip_address');
      expect(entry).toHaveProperty('user_agent');
    });
  });

  test('viewer never receives ip_address / user_agent, even with include_metadata=true', async () => {
    // The read-only role may be shown to a third party; operator metadata
    // stays with admins whatever the query asks (SDL CAT-C-2.11).
    const { body } = await request(app)
      .get(`${BASE_URL}?include_metadata=true`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach(entry => {
      expect(entry).not.toHaveProperty('ip_address');
      expect(entry).not.toHaveProperty('user_agent');
      // The rest of the entry is the same journal an admin sees.
      expect(entry).toHaveProperty('admin_name');
      expect(entry).toHaveProperty('summary');
    });
  });

  test('moderate_approve entry has correct action and entity_type', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?action=moderate_approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const entry = body.data[0];
    expect(entry.action).toBe('moderate_approve');
    expect(entry.entity_type).toBe('establishment');
    expect(entry.entity_id).toBe(approvedEstablishmentId);
  });
});

// ============================================================================
// Sort order
// ============================================================================

describe('GET /api/v1/admin/audit-log — sort order', () => {
  test('default sort is newest first (DESC by created_at)', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    if (body.data.length < 2) return; // can't test sort with < 2 entries

    const timestamps = body.data.map(e => new Date(e.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
    }
  });

  test('?sort=oldest — entries are ascending by created_at', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?sort=oldest`)
      .set('Authorization', `Bearer ${adminToken}`);

    if (body.data.length < 2) return;

    const timestamps = body.data.map(e => new Date(e.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  test('sort=newest and sort=oldest return the same total count', async () => {

    const [newestRes, oldestRes] = await Promise.all([
      request(app).get(`${BASE_URL}?sort=newest`).set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`${BASE_URL}?sort=oldest`).set('Authorization', `Bearer ${adminToken}`),
    ]);

    expect(newestRes.body.meta.total).toBe(oldestRes.body.meta.total);
  });
});

// ============================================================================
// Filters
// ============================================================================

describe('GET /api/v1/admin/audit-log — filters', () => {
  test('?action=moderate_approve — returns only approve entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?action=moderate_approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach(entry => {
      expect(entry.action).toBe('moderate_approve');
    });
  });

  test('?action=moderate_reject — returns only reject entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?action=moderate_reject`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach(entry => {
      expect(entry.action).toBe('moderate_reject');
    });
  });

  test('?entity_type=establishment — returns only establishment entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?entity_type=establishment`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(2); // approve + reject
    body.data.forEach(entry => {
      expect(entry.entity_type).toBe('establishment');
    });
  });

  test('?entity_type=review — returns only review entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?entity_type=review`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach(entry => {
      expect(entry.entity_type).toBe('review');
    });
  });

  test('?user_id=adminUserId — returns only entries by that admin', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?user_id=${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(3);
    // All entries should have the admin's email
    body.data.forEach(entry => {
      expect(entry.admin_email).toBeDefined();
    });
  });

  test('?from=2030-01-01 (future) — returns empty data, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}?from=2030-01-01`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  test('?action=nonexistent_action — returns empty data, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}?action=this_action_does_not_exist`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });
});

// ============================================================================
// Pagination
// ============================================================================

describe('GET /api/v1/admin/audit-log — pagination', () => {
  test('?per_page=1 — returns exactly 1 entry per page', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?per_page=1`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data).toHaveLength(1);
    expect(body.meta.per_page).toBe(1);
    expect(body.meta.pages).toBeGreaterThanOrEqual(3); // at least 3 entries
  });

  test('?per_page=1&page=2 — returns a different entry than page 1', async () => {

    const [page1, page2] = await Promise.all([
      request(app)
        .get(`${BASE_URL}?per_page=1&page=1`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app)
        .get(`${BASE_URL}?per_page=1&page=2`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);

    if (page1.body.data.length > 0 && page2.body.data.length > 0) {
      expect(page1.body.data[0].id).not.toBe(page2.body.data[0].id);
    }
  });

  test('?per_page=100 — capped at 50 (service enforces max)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}?per_page=100`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.meta.per_page).toBe(50);
  });

  test('page beyond last page — returns empty data, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}?page=9999`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  test('meta.pages equals ceil(total / per_page)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}?per_page=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    const expected = Math.ceil(body.meta.total / 2);
    expect(body.meta.pages).toBe(expected);
  });
});

// ============================================================================
// Журнал для просмотрщика — без имён и без текста скрытого (пакет 2, пункт 2;
// заход 2А облачного критика B-2, заход 2Б — 2Б-B1)
// ============================================================================
//
// Просмотрщик видит, ЧТО произошло и КОГДА: тип действия, объект по
// идентификатору, исполнителя по роли. Не видит: имени и e-mail исполнителя
// (модератора или партнёра, удалившего карточку), имени автора отзыва и начала
// текста отзыва, который сейчас скрыт или удалён. Фильтр «действия одного
// человека» ему закрыт. Администратору — как прежде.
//
// Записи журнала создаются настоящими путями записи: действия модератора через
// HTTP, удаление карточки партнёром — моделью, той же, что зовёт сервис.

describe('GET /api/v1/admin/audit-log — проекция просмотрщика (пакет 2, п. 2)', () => {
  const tag = randomUUID().slice(0, 8);
  const MODERATOR_NAME = `Модератор Журнала ${tag}`;
  const MODERATOR_EMAIL = `audit-moderator-${tag}@test.com`;
  const PARTNER_NAME = `Партнёр Удаливший ${tag}`;
  const HIDDEN_AUTHOR = `Автор Скрытого ${tag}`;
  const DELETED_AUTHOR = `Автор Удалённого ${tag}`;
  const SHOWN_AUTHOR = `Автор Вернувшегося ${tag}`;
  const HIDDEN_TEXT = `скрытый-в-журнале-${tag}`;
  const DELETED_TEXT = `удалённый-в-журнале-${tag}`;
  const SHOWN_TEXT = `вернувшийся-в-журнале-${tag}`;

  let partnerEmail;
  let partnerId;
  let moderatorId;
  let pack2ViewerToken;
  const reviewIds = {};

  const namedUser = (name, emailLabel, role = 'user') => createUserAndGetTokens({
    email: `${emailLabel}-${tag}@test.com`,
    phone: null,
    password: 'User123!@#',
    name,
    role,
    authMethod: 'email',
  });

  beforeAll(async () => {
    const moderator = await createUserAndGetTokens({
      email: MODERATOR_EMAIL,
      phone: null,
      password: 'Admin123!@#',
      name: MODERATOR_NAME,
      role: 'admin',
      authMethod: 'email',
    });
    moderatorId = moderator.user.id;
    const moderatorToken = moderator.accessToken;
    pack2ViewerToken = (await namedUser('Pack2 Viewer', 'audit-viewer', 'viewer')).accessToken;

    const { establishment } = await createPartnerWithEstablishment('active');

    const seedReview = async (key, authorName, text) => {
      const author = await namedUser(authorName, `audit-author-${key}`);
      const review = await createTestReview(author.user.id, establishment.id, { content: text });
      reviewIds[key] = review.id;
    };
    await seedReview('hidden', HIDDEN_AUTHOR, HIDDEN_TEXT);
    await seedReview('deleted', DELETED_AUTHOR, DELETED_TEXT);
    await seedReview('shown', SHOWN_AUTHOR, SHOWN_TEXT);

    const act = (path, body) => request(app)
      .post(`/api/v1/admin/reviews/${path}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send(body)
      .expect(200);
    await act(`${reviewIds.hidden}/visibility`, { is_visible: false });
    await act(`${reviewIds.deleted}/delete`, { reason: 'спам' });
    await act(`${reviewIds.shown}/visibility`, { is_visible: false });
    await act(`${reviewIds.shown}/visibility`, { is_visible: true });

    // Карточку удаляет партнёр — запись журнала пишется от его имени.
    const draft = await createPartnerWithEstablishment('draft');
    partnerId = draft.partner.user.id;
    partnerEmail = draft.partner.user.email;
    await query('UPDATE users SET name = $1 WHERE id = $2', [PARTNER_NAME, partnerId]);
    const deleted = await EstablishmentModel.deleteEstablishment(draft.establishment.id, partnerId);
    expect(deleted).not.toBeNull();
  });

  const fetchAll = async (token) => {
    const response = await request(app)
      .get(`${BASE_URL}?per_page=50`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Весь журнал файла умещается в одну страницу — иначе сравнение «те же
    // записи» молча сравнивало бы части.
    expect(response.body.meta.total).toBeLessThanOrEqual(50);
    return response.body;
  };

  // Всё, что о людях и о скрытых текстах. Каждая строка обязана встретиться у
  // администратора (иначе проверка просмотрщика пуста) и не встретиться у
  // просмотрщика.
  const personal = () => [
    MODERATOR_NAME,
    MODERATOR_EMAIL,
    PARTNER_NAME,
    partnerEmail,
    HIDDEN_AUTHOR,
    DELETED_AUTHOR,
    SHOWN_AUTHOR,
    HIDDEN_TEXT,
    DELETED_TEXT,
  ];

  test('администратор на тех же записях видит людей и тексты (контроль)', async () => {
    const body = JSON.stringify(await fetchAll(adminToken));
    for (const value of personal()) {
      expect({ value, present: body.includes(value) }).toEqual({ value, present: true });
    }
  });

  test('просмотрщику — те же записи, но ни имени, ни e-mail, ни автора, ни начала скрытого', async () => {
    const admin = await fetchAll(adminToken);
    const viewer = await fetchAll(pack2ViewerToken);

    expect(viewer.data.map((e) => e.id)).toEqual(admin.data.map((e) => e.id));

    const body = JSON.stringify(viewer);
    for (const value of personal()) {
      expect({ value, present: body.includes(value) }).toEqual({ value, present: false });
    }
  });

  test('исполнитель назван ролью: модератор — admin, удаливший карточку — partner', async () => {
    const viewer = await fetchAll(pack2ViewerToken);

    const hide = viewer.data.find((e) => e.entity_id === reviewIds.hidden && e.action === 'review_hide');
    expect(hide.actor_role).toBe('admin');
    expect(hide).toHaveProperty('admin_name', null);
    expect(hide).toHaveProperty('admin_email', null);

    const partnerDelete = viewer.data.find((e) => e.action === 'partner_delete_establishment');
    expect(partnerDelete.actor_role).toBe('partner');
    expect(partnerDelete).toHaveProperty('admin_name', null);
    expect(partnerDelete).toHaveProperty('admin_email', null);
    // Карточку — бизнес, не человека — журнал называет и просмотрщику.
    expect(partnerDelete.entity_context.name).toBe('Test Establishment');
  });

  test('начало текста отзыва, который сейчас виден, просмотрщику остаётся; автор — нет', async () => {
    const viewer = await fetchAll(pack2ViewerToken);

    const shown = viewer.data.filter((e) => e.entity_id === reviewIds.shown);
    expect(shown.length).toBe(2);
    for (const entry of shown) {
      expect(entry.entity_context.text_snippet).toBe(SHOWN_TEXT);
      expect(entry.entity_context).toHaveProperty('reviewer_name', null);
    }
    const hidden = viewer.data.find((e) => e.entity_id === reviewIds.hidden);
    expect(hidden.entity_context).toHaveProperty('text_snippet', null);
    expect(hidden.entity_context.rating).toBe(4);
  });

  test('модель сама, без общего слоя, не называет людей просмотрщику (ревью Phase 3.5)', async () => {
    // Общий слой ответа (projections/viewerProjection.js) тоже гасит
    // admin_name / admin_email / reviewer_name, и тест маршрута не отличит,
    // какой из двух слоёв сработал. Этот тест держит SQL-слой.
    // Third person the model names: the account an action was about
    // (entity_type 'user' — a block, a name reset). Its entry is written here
    // directly; the shared layer nulls user_name too, so only this run sees
    // the model's own choice.
    const targetName = `Человек Под Блокировкой ${randomUUID().slice(0, 8)}`;
    const target = await createUserAndGetTokens({
      email: `audit-target-${randomUUID().slice(0, 8)}@test.com`, password: 'Target123!@#', name: targetName, role: 'user',
    });
    const { rows: [written] } = await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
       VALUES ($1, 'user_block', 'user', $2, '{}'::jsonb) RETURNING id`,
      [moderatorId, target.user.id],
    );
    let adminEntries;
    let entries;
    try {
      adminEntries = await AuditLogModel.getAuditLogEntries({}, 50, 0);
      entries = await AuditLogModel.getAuditLogEntries({ viewer: true }, 50, 0);
    } finally {
      // The tests below count the moderator's entries: this one is not theirs.
      await query('DELETE FROM audit_log WHERE id = $1', [written.id]);
    }
    expect(JSON.stringify(adminEntries)).toContain(targetName); // the entry names the person to an admin
    const body = JSON.stringify(entries);

    expect(entries.length).toBeGreaterThan(0);
    for (const value of [MODERATOR_NAME, MODERATOR_EMAIL, PARTNER_NAME, partnerEmail, HIDDEN_AUTHOR, targetName]) {
      expect({ value, present: body.includes(value) }).toEqual({ value, present: false });
    }
  });

  test('фильтр «действия одного человека» просмотрщику отвергается', async () => {
    const response = await request(app)
      .get(`${BASE_URL}?user_id=${moderatorId}`)
      .set('Authorization', `Bearer ${pack2ViewerToken}`)
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain(MODERATOR_NAME);
  });

  test('администратору фильтр по исполнителю работает, роль исполнителя тоже приходит', async () => {
    const response = await request(app)
      .get(`${BASE_URL}?user_id=${moderatorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data.length).toBe(4);
    for (const entry of response.body.data) {
      expect(entry.admin_name).toBe(MODERATOR_NAME);
      expect(entry.admin_email).toBe(MODERATOR_EMAIL);
      expect(entry.actor_role).toBe('admin');
    }
  });
});
