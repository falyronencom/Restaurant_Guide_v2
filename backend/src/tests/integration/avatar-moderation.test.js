/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Фото профиля другие люди видят только после одобрения модератором
 * (миграция 041; слово Координатора 09.11.2026, нитка «Фото людей»,
 * docs/handoffs/ugc_moderation_step1_20261110/DIRECTIVE.md §2).
 *
 * Что закреплено:
 *  - публичные ответы с отзывами (сайт, старый путь приложения, отзыв по номеру)
 *    отдают фото автора только одобренным и только у карточки в каталоге;
 *    свой профиль отдаёт своё фото всегда;
 *  - каждое из пяти мест записи фото возвращает его на проверку: загрузка,
 *    PUT /auth/profile, новая учётка через провайдера, привязка, перехват;
 *  - очередь модератора, одобрение и снятие, журнал в той же транзакции;
 *  - снятое, убранное и заменённое фото уходит из облака через очередь файлов —
 *    только этот файл, только из папки человека;
 *  - окно до миграции 041: ничего не падает, другим — буква.
 *
 * На старом коде красный каждый тест: публичный ответ отдавал любое фото,
 * маршрутов /avatar/approve и /avatar/remove не было, очереди файлов не было.
 *
 * База настоящая, HTTP настоящий. Облако заглушено на уровне SDK (upload,
 * destroy); выход в сеть из теста — провал.
 */

import https from 'https';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import cloudinary from '../../config/cloudinary.js';
import { authenticateWithOAuth } from '../../services/authService.js';
import * as avatarDeletionLoop from '../../services/avatarDeletionLoop.js';
import { invalidateCache as invalidateBadges } from '../../services/badgesService.js';
import { pool } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createViewerAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
} from '../utils/adminTestHelpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '..', '..', '..', 'migrations', '041_avatar_moderation.sql');

const ADMIN = '/api/v1/admin';
const JPEG = { filename: 'face.jpg', contentType: 'image/jpeg' };

const cloudUrl = (publicId) => `https://res.cloudinary.com/test/image/upload/v1759600000/${publicId}.jpg`;
const GOOGLE_PICTURE = 'https://lh3.googleusercontent.com/a/face-of-the-person=s96-c';
const YANDEX_PICTURE = 'https://avatars.yandex.net/get-yapic/12345/islands-200';

let admin;
let viewer;
let card;
let uploads;
let destroy;

const asAdmin = (method, url, body) => request(app)[method](`${ADMIN}${url}`)
  .set('Authorization', `Bearer ${admin.accessToken}`)
  .send(body);

const asViewer = (method, url) => request(app)[method](`${ADMIN}${url}`)
  .set('Authorization', `Bearer ${viewer.accessToken}`);

const person = async ({ role = 'user', avatar = null } = {}) => {
  const email = `photo-${randomUUID()}@test.com`;
  const created = await createUserAndGetTokens({
    email, password: 'Person123!@#', name: 'Иван Тестов', role, authMethod: 'email',
  });
  const id = created.user.id;
  if (avatar) await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [id, avatar(id)]);
  return { ...created, email, id };
};

const ownFile = (name) => (id) => cloudUrl(`avatars/${id}/${name}`);

/** Фото автора в трёх публичных ответах: сайт, приложение, отзыв по номеру. */
const publicAvatars = async (reviewId, establishment = card) => {
  const site = await request(app)
    .get(`/api/v1/public/establishments/by-slug/${establishment.slug}/reviews`);
  const appPath = await request(app).get(`/api/v1/establishments/${establishment.id}/reviews`).expect(200);
  const byId = await request(app).get(`/api/v1/reviews/${reviewId}`).expect(200);
  const fromList = (body) => body.data.reviews.find((r) => r.id === reviewId)?.author.avatar_url;
  return {
    site: site.status === 200 ? fromList(site.body) : `HTTP ${site.status}`,
    app: fromList(appPath.body),
    byId: byId.body.data.review.author.avatar_url,
  };
};

const NOBODY_SEES = { site: null, app: null, byId: null };
const everybodySees = (url) => ({ site: url, app: url, byId: url });

const ownProfile = async (p) => (await request(app)
  .get('/api/v1/auth/me')
  .set('Authorization', `Bearer ${p.accessToken}`)
  .expect(200)).body.data.user.avatarUrl;

const storedAvatar = async (id) => (await query('SELECT avatar_url FROM users WHERE id = $1', [id])).rows[0].avatar_url;

const approve = (id, avatarUrl) => asAdmin('post', `/users/${id}/avatar/approve`, { avatar_url: avatarUrl });
const remove = (id, avatarUrl, reason) => asAdmin('post', `/users/${id}/avatar/remove`, { avatar_url: avatarUrl, reason });

const fileTasks = async (userId) => (await query(
  'SELECT public_id, reason, status FROM avatar_file_deletions WHERE user_id = $1 ORDER BY public_id',
  [userId],
)).rows;

const journal = async (userId, action) => (await query(
  `SELECT user_id, old_data, new_data FROM audit_log
   WHERE entity_type = 'user' AND entity_id = $1 AND action = $2 ORDER BY created_at`,
  [userId, action],
)).rows;

const registration = {
  reserveNewAccount: async () => ({ granted: true, giveBack: async () => {} }),
};

const signIn = (data) => authenticateWithOAuth({ emailVerified: true, name: 'Пётр Провайдеров', ...data }, registration);

/** Ждать, пока чей-то запрос встанет в очередь за блокировкой строки. */
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

const queueIds = async () => (await asAdmin('get', '/users?avatar=pending&per_page=50').expect(200))
  .body.data.map((u) => u.id);

beforeEach(async () => {
  await clearAllData();
  admin = await createAdminAndGetToken();
  viewer = await createViewerAndGetToken();
  jest.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('в этом тесте сети нет');
  });
  ({ establishment: card } = await createPartnerWithEstablishment('active'));
  uploads = 0;
  jest.spyOn(cloudinary.uploader, 'upload').mockImplementation(async (_path, options) => {
    uploads += 1;
    const publicId = `${options.folder}/fresh${String(uploads).padStart(4, '0')}`;
    return { public_id: publicId, secure_url: cloudUrl(publicId), width: 256, height: 256, format: 'jpg', bytes: 2048 };
  });
  destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  invalidateBadges();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Фильтр публичных ответов
// ============================================================================

describe('другие видят фото только одобренным', () => {
  test('неодобренное: в трёх публичных ответах буква, в своём профиле — фото', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const review = await createTestReview(p.id, card.id);

    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await ownProfile(p)).toBe(cloudUrl(`avatars/${p.id}/face0001`));
  });

  test('одобренное — видят все; у карточки вне каталога — снова буква (находка 1)', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const url = cloudUrl(`avatars/${p.id}/face0001`);
    const review = await createTestReview(p.id, card.id);

    await approve(p.id, url).expect(200);
    expect(await publicAvatars(review.id)).toEqual(everybodySees(url));

    for (const status of ['suspended', 'pending', 'draft', 'rejected']) {
      await query('UPDATE establishments SET status = $2 WHERE id = $1', [card.id, status]);
      expect(await publicAvatars(review.id)).toEqual({ site: 'HTTP 404', app: null, byId: null });
    }
  });

  test('одна мерка для всех учёток: фото панели, служебной и заблокированной без одобрения не видно, в очереди их нет', async () => {
    const service = await person({ role: 'partner', avatar: ownFile('svc0001') });
    await query('UPDATE users SET is_service_account = TRUE WHERE id = $1', [service.id]);
    const blocked = await person({ avatar: ownFile('blk0001') });
    const panel = await person({ avatar: ownFile('pnl0001') });
    await query("UPDATE users SET role = 'viewer' WHERE id = $1", [panel.id]);
    const queued = await person({ avatar: ownFile('usr0001') });

    for (const who of [service, blocked, panel, queued]) {
      const review = await createTestReview(who.id, card.id);
      expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    }
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [blocked.id]);

    expect(await queueIds()).toEqual([queued.id]);
    expect((await asAdmin('get', '/badges').expect(200)).body.data.avatars_pending).toBe(1);
  });
});

// ============================================================================
// Каждое место записи фото возвращает его на проверку
// ============================================================================

describe('новое фото снова ждёт одобрения — в каждом месте записи', () => {
  const approvedWithReview = async (p, url) => {
    const review = await createTestReview(p.id, card.id);
    await approve(p.id, url).expect(200);
    expect(await publicAvatars(review.id)).toEqual(everybodySees(url));
    return review;
  };

  test('загрузка POST /auth/avatar', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const review = await approvedWithReview(p, cloudUrl(`avatars/${p.id}/face0001`));

    const response = await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
      .expect(200);

    const fresh = cloudUrl(`avatars/${p.id}/fresh0001`);
    expect(response.body.data.user.avatarUrl).toBe(fresh);
    expect(await ownProfile(p)).toBe(fresh);
    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await queueIds()).toEqual([p.id]);
  });

  test('PUT /auth/profile — ссылка на другой свой файл', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const review = await approvedWithReview(p, cloudUrl(`avatars/${p.id}/face0001`));

    await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ avatar_url: cloudUrl(`avatars/${p.id}/face0002`) })
      .expect(200);

    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await fileTasks(p.id)).toEqual([
      { public_id: `avatars/${p.id}/face0001`, reason: 'replaced', status: 'pending' },
    ]);
  });

  test('новая учётка через Google: фото провайдера ждёт модератора', async () => {
    const result = await signIn({ provider: 'google', providerId: `g-${randomUUID()}`, email: `new-${randomUUID()}@test.com`, avatarUrl: GOOGLE_PICTURE });
    const review = await createTestReview(result.user.id, card.id);

    expect(result.user.avatar_url).toBe(GOOGLE_PICTURE);
    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await queueIds()).toEqual([result.user.id]);
  });

  test('привязка Яндекса к учётке без фото: фото ждёт модератора', async () => {
    const p = await person();
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [p.id]);
    const review = await createTestReview(p.id, card.id);

    await signIn({ provider: 'yandex', providerId: `y-${randomUUID()}`, email: p.email, avatarUrl: YANDEX_PICTURE });

    expect(await storedAvatar(p.id)).toBe(YANDEX_PICTURE);
    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
  });

  test('перехват неподтверждённой учётки: фото провайдера ждёт, файл прежнего владельца уходит из облака', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const review = await approvedWithReview(p, cloudUrl(`avatars/${p.id}/face0001`));

    await signIn({ provider: 'google', providerId: `g-${randomUUID()}`, email: p.email, avatarUrl: GOOGLE_PICTURE });

    expect(await storedAvatar(p.id)).toBe(GOOGLE_PICTURE);
    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await fileTasks(p.id)).toEqual([
      { public_id: `avatars/${p.id}/face0001`, reason: 'taken_over', status: 'pending' },
    ]);
  });

  test('снятое модератором: повторный вход через другого провайдера не обходит очередь', async () => {
    const google = await signIn({ provider: 'google', providerId: `g-${randomUUID()}`, email: `back-${randomUUID()}@test.com`, avatarUrl: GOOGLE_PICTURE });
    const id = google.user.id;
    const review = await createTestReview(id, card.id);
    await remove(id, GOOGLE_PICTURE).expect(200);

    // Тот же провайдер — путь «уже знакомый вход»: фото не пишется вовсе.
    await signIn({ provider: 'google', providerId: google.user.oauth_provider_id, email: google.user.email, avatarUrl: GOOGLE_PICTURE });
    expect(await storedAvatar(id)).toBeNull();

    // Другой провайдер с тем же адресом — привязка пишет его фото: на проверку.
    await signIn({ provider: 'yandex', providerId: `y-${randomUUID()}`, email: google.user.email, avatarUrl: YANDEX_PICTURE });
    expect(await storedAvatar(id)).toBe(YANDEX_PICTURE);
    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await queueIds()).toEqual([id]);
  });
});

// ============================================================================
// Панель: очередь, одобрение, снятие, журнал
// ============================================================================

describe('модератор видит очередь и решает одним действием', () => {
  test('очередь: фото, имя, почта; у одобренного — состояние «одобрено» и из очереди уходит', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const url = cloudUrl(`avatars/${p.id}/face0001`);

    const listed = (await asAdmin('get', '/users?avatar=pending').expect(200)).body.data;
    expect(listed).toEqual([expect.objectContaining({
      id: p.id, name: 'Иван Тестов', email: p.email, avatar_url: url, avatar_state: 'pending',
    })]);

    const answer = await approve(p.id, url).expect(200);
    expect(answer.body.data).toEqual({ id: p.id, avatar_state: 'approved', changed: true });
    expect(await queueIds()).toEqual([]);
    expect((await asAdmin('get', `/users/${p.id}`).expect(200)).body.data)
      .toEqual(expect.objectContaining({ avatar_url: url, avatar_state: 'approved' }));
  });

  test('экран отзывов: фото автора и его состояние рядом с отзывом', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    await createTestReview(p.id, card.id);

    const rows = (await asAdmin('get', `/reviews?user_id=${p.id}`).expect(200)).body.data;
    expect(rows).toEqual([expect.objectContaining({
      author_avatar_url: cloudUrl(`avatars/${p.id}/face0001`), author_avatar_state: 'pending',
    })]);
  });

  test('просмотрщик фото людей не получает — ни в списке, ни в отзывах, ни в журнале', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    await createTestReview(p.id, card.id);
    await remove(p.id, cloudUrl(`avatars/${p.id}/face0001`), 'Неподобающее фото').expect(200);
    await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [p.id, cloudUrl(`avatars/${p.id}/face0002`)]);

    // Ни фото, ни его состояния, и отбора очереди у просмотрщика нет: кто ждёт
    // проверки фото — факт о человеке (ревью по линзе, находка 3).
    const users = (await asViewer('get', '/users?avatar=pending').expect(200)).body.data;
    // Отбор не применён: в ответе и учётки без фото (сам администратор).
    expect(users.map((u) => u.id)).toEqual(expect.arrayContaining([admin.user.id, p.id]));
    expect(users.find((u) => u.id === p.id)).toEqual(expect.objectContaining({ avatar_url: null, avatar_state: null }));
    const reviews = (await asViewer('get', '/reviews').expect(200)).body.data;
    expect(reviews.map((r) => [r.author_avatar_url, r.author_avatar_state])).toEqual([[null, null]]);
    const entries = (await asViewer('get', '/audit-log?action=user_avatar_remove').expect(200)).body.data;
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries)).not.toContain('face0001');
    expect(JSON.stringify(entries)).not.toContain('Неподобающее');
  });

  test('одобрение: журнал в той же транзакции; повтор ничего не пишет', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const url = cloudUrl(`avatars/${p.id}/face0001`);

    await approve(p.id, url).expect(200);
    const again = await approve(p.id, url).expect(200);

    expect(again.body.data.changed).toBe(false);
    expect(await journal(p.id, 'user_avatar_approve')).toEqual([{
      user_id: admin.user.id,
      old_data: { avatar_url: url, avatar_state: 'pending' },
      new_data: { avatar_state: 'approved' },
    }]);
  });

  test('журнал не записался — одобрения нет', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const url = cloudUrl(`avatars/${p.id}/face0001`);
    const review = await createTestReview(p.id, card.id);
    await query(`CREATE OR REPLACE FUNCTION test_refuse_avatar_journal() RETURNS trigger AS $$
      BEGIN IF NEW.action LIKE 'user_avatar_%' THEN RAISE EXCEPTION 'журнал недоступен'; END IF; RETURN NEW; END $$
      LANGUAGE plpgsql`);
    await query(`CREATE TRIGGER test_refuse_avatar_journal BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION test_refuse_avatar_journal()`);
    try {
      await approve(p.id, url).expect(500);
      await remove(p.id, url).expect(500);
    } finally {
      await query('DROP TRIGGER test_refuse_avatar_journal ON audit_log');
      await query('DROP FUNCTION test_refuse_avatar_journal()');
    }

    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await storedAvatar(p.id)).toBe(url);
    expect(await fileTasks(p.id)).toEqual([]);
  });

  test('фото сменилось после того, как модератор его увидел: отказ, новое фото не тронуто', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const seen = cloudUrl(`avatars/${p.id}/face0001`);
    await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
      .expect(200);
    const fresh = cloudUrl(`avatars/${p.id}/fresh0001`);

    for (const action of [approve(p.id, seen), remove(p.id, seen)]) {
      const refused = await action.expect(409);
      expect([refused.body.error.code, refused.body.message]).toEqual([
        'AVATAR_CHANGED', 'Фото уже сменилось или убрано. Обновите список и посмотрите, что стоит сейчас',
      ]);
    }
    expect(await storedAvatar(p.id)).toBe(fresh);
    expect(await queueIds()).toEqual([p.id]);
    await avatarDeletionLoop.tick();
    expect(destroy.mock.calls).toEqual([[`avatars/${p.id}/face0001`, { invalidate: true }]]);
  });

  test('своё фото модератор не одобряет и не снимает; без ссылки — отказ', async () => {
    await query('UPDATE users SET avatar_url = $2 WHERE id = $1', [admin.user.id, cloudUrl(`avatars/${admin.user.id}/me0001`)]);
    const own = cloudUrl(`avatars/${admin.user.id}/me0001`);
    try {
      expect((await approve(admin.user.id, own).expect(409)).body.error.code).toBe('AVATAR_SELF');
      expect((await remove(admin.user.id, own).expect(409)).body.error.code).toBe('AVATAR_SELF');
    } finally {
      await query('UPDATE users SET avatar_url = NULL WHERE id = $1', [admin.user.id]);
    }
    const p = await person({ avatar: ownFile('face0001') });
    expect((await asAdmin('post', `/users/${p.id}/avatar/approve`, {}).expect(422)).body.error.code)
      .toBe('AVATAR_SEEN_REQUIRED');
    expect((await request(app).post(`${ADMIN}/users/${p.id}/avatar/approve`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ avatar_url: cloudUrl(`avatars/${p.id}/face0001`) })).status).toBe(403);
  });
});

describe('снятое фото исчезает для всех и уходит из облака', () => {
  test('своё облако: поле пусто и у самого человека, файл удаляется петлёй со сбросом копий, новое не задето', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const url = cloudUrl(`avatars/${p.id}/face0001`);
    const review = await createTestReview(p.id, card.id);
    await approve(p.id, url).expect(200);

    const answer = await remove(p.id, url, 'Неподобающее фото').expect(200);

    expect(answer.body.data).toEqual({ id: p.id, avatar_state: 'none', file: 'cloud', changed: true });
    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await ownProfile(p)).toBeNull();
    expect(await fileTasks(p.id)).toEqual([
      { public_id: `avatars/${p.id}/face0001`, reason: 'moderator_removed', status: 'pending' },
    ]);
    expect(await journal(p.id, 'user_avatar_remove')).toEqual([{
      user_id: admin.user.id,
      old_data: { avatar_url: url, avatar_state: 'approved' },
      new_data: { avatar_state: 'none', file: 'cloud', reason: 'Неподобающее фото' },
    }]);

    // Человек загрузил новое фото до прохода петли: оно ждёт своей проверки.
    await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
      .expect(200);
    await avatarDeletionLoop.tick();

    expect(destroy.mock.calls).toEqual([[`avatars/${p.id}/face0001`, { invalidate: true }]]);
    expect(await fileTasks(p.id)).toEqual([
      { public_id: `avatars/${p.id}/face0001`, reason: 'moderator_removed', status: 'done' },
    ]);
    expect(await storedAvatar(p.id)).toBe(cloudUrl(`avatars/${p.id}/fresh0001`));
  });

  test('фото провайдера: поле пусто, облако не зовётся', async () => {
    const p = await person({ avatar: () => GOOGLE_PICTURE });

    const answer = await remove(p.id, GOOGLE_PICTURE).expect(200);
    await avatarDeletionLoop.tick();

    expect(answer.body.data.file).toBe('external');
    expect(await storedAvatar(p.id)).toBeNull();
    expect(await fileTasks(p.id)).toEqual([]);
    expect(destroy).not.toHaveBeenCalled();
  });

  test('сбой облака: задача ждёт паузу и закрывается следующим проходом', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    await remove(p.id, cloudUrl(`avatars/${p.id}/face0001`)).expect(200);
    destroy.mockRejectedValueOnce({ error: { message: 'Сломалось', http_code: 500 } });
    jest.spyOn((await import('../../utils/logger.js')).default, 'warn').mockImplementation(() => {});

    await avatarDeletionLoop.tick();
    const { rows: [failed] } = await query(
      `SELECT status, attempts, last_error, next_attempt_at > NOW() AS waits FROM avatar_file_deletions WHERE user_id = $1`,
      [p.id],
    );
    expect(failed).toEqual(expect.objectContaining({ status: 'pending', attempts: 1, waits: true }));
    expect(failed.last_error).toContain('Сломалось');

    await query("UPDATE avatar_file_deletions SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE user_id = $1", [p.id]);
    await avatarDeletionLoop.tick();

    expect(destroy).toHaveBeenCalledTimes(2);
    expect((await fileTasks(p.id))[0].status).toBe('done');
  });
});

describe('фото, убранное или заменённое самим человеком, уходит из облака', () => {
  test('очистка в профиле: задача «cleared» на свой файл; фото провайдера — без задачи', async () => {
    const own = await person({ avatar: ownFile('face0001') });
    const provider = await person({ avatar: () => GOOGLE_PICTURE });

    for (const p of [own, provider]) {
      await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${p.accessToken}`)
        .send({ avatar_url: null })
        .expect(200);
      expect(await storedAvatar(p.id)).toBeNull();
    }

    expect(await fileTasks(own.id)).toEqual([
      { public_id: `avatars/${own.id}/face0001`, reason: 'cleared', status: 'pending' },
    ]);
    expect(await fileTasks(provider.id)).toEqual([]);
    await avatarDeletionLoop.tick();
    expect(destroy.mock.calls).toEqual([[`avatars/${own.id}/face0001`, { invalidate: true }]]);
  });

  test('имя без поля фото: файл не трогается', async () => {
    const p = await person({ avatar: ownFile('face0001') });

    await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ name: 'Новое Имя' })
      .expect(200);

    expect(await fileTasks(p.id)).toEqual([]);
  });
});

// ============================================================================
// Исправления по ревью перед коммитом (Phase 3.5)
// ============================================================================

describe('одобрение живёт только со своей ссылкой', () => {
  test('ссылка с чужого хоста (до шлюза 02.10): одобрить нельзя, снять — можно', async () => {
    const p = await person({ avatar: () => 'https://images.example.org/face.jpg' });

    const refused = await approve(p.id, 'https://images.example.org/face.jpg').expect(409);
    expect([refused.body.error.code, refused.body.message]).toEqual([
      'AVATAR_NOT_APPROVABLE',
      'Это фото не из нашего облака и не из входа через Google или Яндекс — одобрить его нельзя, только снять',
    ]);
    await remove(p.id, 'https://images.example.org/face.jpg').expect(200);
    expect(await storedAvatar(p.id)).toBeNull();
  });

  test('человек убрал одобренное фото и вернул ту же ссылку — снова на проверке', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const url = cloudUrl(`avatars/${p.id}/face0001`);
    const review = await createTestReview(p.id, card.id);
    await approve(p.id, url).expect(200);
    const put = (avatarUrl) => request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ avatar_url: avatarUrl })
      .expect(200);

    await put(null);
    await put(url);

    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
    expect(await queueIds()).toEqual([p.id]);
  });

  test('перехват: новый владелец не возвращает лицо прежнего мимо модератора', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const registrantFace = cloudUrl(`avatars/${p.id}/face0001`);
    const review = await createTestReview(p.id, card.id);
    await approve(p.id, registrantFace).expect(200);

    const holder = await signIn({ provider: 'google', providerId: `g-${randomUUID()}`, email: p.email, avatarUrl: null });
    await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${holder.accessToken}`)
      .send({ avatar_url: registrantFace })
      .expect(200);

    expect(await storedAvatar(p.id)).toBe(registrantFace);
    expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
  });

  test('модератор одобряет, пока человек меняет фото: одобрение ждёт строку и отказывает', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const seen = cloudUrl(`avatars/${p.id}/face0001`);
    const fresh = cloudUrl(`avatars/${p.id}/face0002`);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [p.id]);
      await holder.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [p.id, fresh]);
      const pending = approve(p.id, seen).then((r) => r);
      await waitForLockWaiter();
      await holder.query('COMMIT');
      const answer = await pending;
      expect([answer.status, answer.body.error?.code]).toEqual([409, 'AVATAR_CHANGED']);
    } finally {
      holder.release();
    }
    const { rows: [row] } = await query('SELECT avatar_url, avatar_approved_url FROM users WHERE id = $1', [p.id]);
    expect(row).toEqual({ avatar_url: fresh, avatar_approved_url: null });
  });

  test('файл, к которому человек вернулся, петля не удаляет', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const first = cloudUrl(`avatars/${p.id}/face0001`);
    await request(app)
      .post('/api/v1/auth/avatar')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
      .expect(200);
    await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ avatar_url: first })
      .expect(200);

    await avatarDeletionLoop.tick();

    // Заменённое fresh0001 удалено; face0001 — снова фото человека — цело.
    expect(destroy.mock.calls).toEqual([[`avatars/${p.id}/fresh0001`, { invalidate: true }]]);
    expect((await fileTasks(p.id)).map((t) => [t.public_id, t.status])).toEqual([
      [`avatars/${p.id}/face0001`, 'done'],
      [`avatars/${p.id}/fresh0001`, 'done'],
    ]);
    expect(await storedAvatar(p.id)).toBe(first);
  });
});

// ============================================================================
// Окно между выкаткой и миграцией 041
// ============================================================================

describe('схема без миграции 041: ничего не падает, другим — буква', () => {
  // Колонку и таблицу снимает сам тест и возвращает в `finally`. Убитый между
  // ними прогон оставит их снятыми: вернуть — применив
  // backend/migrations/041_avatar_moderation.sql. Изолированный раннер
  // (scripts/test-isolated) собирает свою базу заново.
  const withoutMigration = async (work) => {
    await query('DROP TABLE avatar_file_deletions');
    await query('ALTER TABLE users DROP COLUMN avatar_approved_url');
    try {
      await work();
    } finally {
      await query(readFileSync(MIGRATION, 'utf8'));
    }
  };

  test('публичные ответы, свой профиль, панель, бейджи; действия модератора — понятный отказ', async () => {
    const p = await person({ avatar: ownFile('face0001') });
    const url = cloudUrl(`avatars/${p.id}/face0001`);
    const review = await createTestReview(p.id, card.id);

    await withoutMigration(async () => {
      expect(await publicAvatars(review.id)).toEqual(NOBODY_SEES);
      expect(await ownProfile(p)).toBe(url);
      expect(await queueIds()).toEqual([p.id]);
      expect((await asAdmin('get', `/reviews?user_id=${p.id}`).expect(200)).body.data[0].author_avatar_state).toBe('pending');
      expect((await asAdmin('get', '/badges').expect(200)).body.data.avatars_pending).toBe(1);
      for (const action of [approve(p.id, url), remove(p.id, url)]) {
        const refused = await action.expect(409);
        expect(refused.body.message)
          .toBe('Проверка фото включится после обновления базы данных. Сообщите оператору платформы');
      }
      expect(await storedAvatar(p.id)).toBe(url);
    });
  });

  test('замена и очистка фото работают; старый файл удаляется прежним путём, петля молчит', async () => {
    const replacing = await person({ avatar: ownFile('face0001') });
    const clearing = await person({ avatar: ownFile('face0002') });
    const info = jest.spyOn((await import('../../utils/logger.js')).default, 'info');

    await withoutMigration(async () => {
      await request(app)
        .post('/api/v1/auth/avatar')
        .set('Authorization', `Bearer ${replacing.accessToken}`)
        .attach('avatar', Buffer.from('fake-jpeg'), JPEG)
        .expect(200);
      await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${clearing.accessToken}`)
        .send({ avatar_url: '' })
        .expect(200);
      await new Promise((resolve) => { setTimeout(resolve, 50); });

      expect(destroy.mock.calls.sort()).toEqual([
        [`avatars/${clearing.id}/face0002`, { invalidate: true }],
        [`avatars/${replacing.id}/face0001`, { invalidate: true }],
      ].sort());
      expect(await storedAvatar(replacing.id)).toBe(cloudUrl(`avatars/${replacing.id}/fresh0001`));
      expect(await storedAvatar(clearing.id)).toBeNull();

      const fresh = await import('../../services/avatarDeletionLoop.js?window=041');
      await fresh.tick();
      await fresh.tick();
      expect(info.mock.calls.filter(([line]) => line.startsWith('Avatar file deletion')))
        .toEqual([['Avatar file deletion: no table yet (migration 041), nothing to do']]);
    });
  });
});
