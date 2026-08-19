/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Badges Integration Tests — счётчики очередей (Б2) и возраст старейшей
 * заявки в обзоре (Б1).
 *
 * Оба поля питают одно и то же место в интерфейсе: бейджи навигационного рейла
 * админки и панель «Требует внимания» на дашборде. Раньше фронт не мог их
 * посчитать — очередь отдаётся страницами по 20, максимума по ней он не видит.
 *
 * Фикстуры (собираются один раз в beforeAll):
 *   3 заведения на модерации, старейшее состарено на 9 дней · 2 приостановленных
 *   1 активное (не должно попадать ни в одну очередь)
 *   2 висящих флага позиций меню: один свежий, один старше 7 дней
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
} from '../utils/adminTestHelpers.js';
import * as badgesService from '../../services/badgesService.js';

const BADGES_URL = '/api/v1/admin/badges';
const OVERVIEW_URL = '/api/v1/admin/analytics/overview';

let adminToken;
let userToken;
let oldestPendingId;

/** Привязывает медиа-строку меню и возвращает её id. */
async function addMenuMedia(establishmentId) {
  const id = randomUUID();
  await query(
    `INSERT INTO establishment_media (id, establishment_id, type, url, file_type)
     VALUES ($1, $2, 'menu', $3, 'image')`,
    [id, establishmentId, `https://example.test/${id}.jpg`],
  );
  return id;
}

/** Позиция меню с висящим флагом. [ageDays] состаривает её. */
async function addFlaggedItem(establishmentId, mediaId, ageDays = 0) {
  const id = randomUUID();
  await query(
    `INSERT INTO menu_items (id, establishment_id, media_id, item_name, sanity_flag, is_hidden_by_admin, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW() - ($6 || ' days')::interval)`,
    [
      id,
      establishmentId,
      mediaId,
      'Тестовое блюдо',
      JSON.stringify({ reason: 'low_confidence' }),
      String(ageDays),
    ],
  );
  return id;
}

beforeAll(async () => {
  await clearAllData();

  adminToken = (await createAdminAndGetToken()).accessToken;
  userToken = (await createUserAndGetTokens({
    email: `badges-user-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: 'Badges Regular User',
    authMethod: 'email',
  })).accessToken;

  // Три на модерации. Старейшую состариваем — на ней проверяется Б1.
  const pendingOne = await createPartnerWithEstablishment('pending');
  await createPartnerWithEstablishment('pending');
  await createPartnerWithEstablishment('pending');
  oldestPendingId = pendingOne.establishment.id;
  await query(
    "UPDATE establishments SET created_at = NOW() - INTERVAL '9 days' WHERE id = $1",
    [oldestPendingId],
  );

  await createPartnerWithEstablishment('suspended');
  await createPartnerWithEstablishment('suspended');

  // Активное — контрольное: не должно попасть ни в одну очередь.
  const active = await createPartnerWithEstablishment('active');
  const mediaId = await addMenuMedia(active.establishment.id);
  await addFlaggedItem(active.establishment.id, mediaId, 0);
  await addFlaggedItem(active.establishment.id, mediaId, 12);
});

afterAll(async () => {
  await clearAllData();
});

beforeEach(() => {
  // Кэш живёт в модуле и переживает тесты — иначе первый же прогретый ответ
  // «залипнет» на всю сюиту и следующие проверки будут смотреть в прошлое.
  badgesService.invalidateCache();
});

// ===========================================================================
// GET /admin/badges — доступ
// ===========================================================================

describe('GET /api/v1/admin/badges — доступ', () => {
  it('без токена отвечает 401', async () => {
    const res = await request(app).get(BADGES_URL);
    expect(res.status).toBe(401);
  });

  it('обычному пользователю отвечает 403', async () => {
    const res = await request(app)
      .get(BADGES_URL)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// GET /admin/badges — содержимое
// ===========================================================================

describe('GET /api/v1/admin/badges — счётчики', () => {
  it('отдаёт конверт и все четыре счётчика', async () => {
    const res = await request(app)
      .get(BADGES_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      establishments_pending: 3,
      establishments_suspended: 2,
      menu_flags: 2,
      menu_flags_aged_over_7d: 1,
      generated_at: expect.any(String),
    });
  });

  it('активное заведение не считается ни одной очередью', async () => {
    const { data } = (
      await request(app)
        .get(BADGES_URL)
        .set('Authorization', `Bearer ${adminToken}`)
    ).body;

    // Всего заведений 6, в очередях — только 5.
    expect(data.establishments_pending + data.establishments_suspended).toBe(5);
  });

  it('второй вызов в пределах TTL отдаёт тот же снимок', async () => {
    const first = await badgesService.getBadges();
    const second = await badgesService.getBadges();

    expect(second.generated_at).toBe(first.generated_at);
    expect(second).toBe(first);
  });

  it('force обходит кэш и пересчитывает', async () => {
    const cached = await badgesService.getBadges();
    const fresh = await badgesService.getBadges({ force: true });

    expect(fresh).not.toBe(cached);
    expect(fresh.establishments_pending).toBe(cached.establishments_pending);
  });

  it('после сброса кэша видит изменение очереди', async () => {
    const before = await badgesService.getBadges();
    expect(before.establishments_suspended).toBe(2);

    await query(
      "UPDATE establishments SET status = 'active' WHERE status = 'suspended'",
    );

    // Пока кэш не сброшен — старое значение, это и есть смысл кэша.
    expect((await badgesService.getBadges()).establishments_suspended).toBe(2);

    badgesService.invalidateCache();
    expect((await badgesService.getBadges()).establishments_suspended).toBe(0);

    // Возвращаем фикстуру, чтобы порядок тестов не влиял на соседей.
    await query(
      "UPDATE establishments SET status = 'suspended' WHERE id IN (SELECT id FROM establishments WHERE status = 'active' AND id <> $1 LIMIT 2)",
      [oldestPendingId],
    );
    badgesService.invalidateCache();
  });
});

// ===========================================================================
// Б1 — возраст старейшей заявки в обзоре
// ===========================================================================

describe('GET /api/v1/admin/analytics/overview — oldest_pending_at', () => {
  it('отдаёт время создания старейшей заявки в очереди', async () => {
    const res = await request(app)
      .get(OVERVIEW_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const { moderation } = res.body.data;
    expect(moderation.pending_count).toBe(3);
    expect(typeof moderation.oldest_pending_at).toBe('string');

    // Состарили на 9 дней — проверяем порядок величины, а не точную метку:
    // между вставкой и запросом проходит неопределённое время.
    const ageDays =
      (Date.now() - new Date(moderation.oldest_pending_at).getTime()) /
      86_400_000;
    expect(ageDays).toBeGreaterThan(8.9);
    expect(ageDays).toBeLessThan(9.1);
  });

  it('при пустой очереди отдаёт null, а не выдуманную дату', async () => {
    await query("UPDATE establishments SET status = 'rejected' WHERE status = 'pending'");

    const res = await request(app)
      .get(OVERVIEW_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data.moderation.pending_count).toBe(0);
    expect(res.body.data.moderation.oldest_pending_at).toBeNull();

    await query(
      "UPDATE establishments SET status = 'pending' WHERE status = 'rejected'",
    );
  });
});

// ===========================================================================
// Инвалидация кэша со стороны записи
// ===========================================================================

describe('Действие модератора сбрасывает кэш счётчиков', () => {
  it('после одобрения бейдж показывает новое число, а не прежнее', async () => {
    // Прогреваем кэш — именно он и мог бы соврать.
    const before = await request(app)
      .get(BADGES_URL)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.body.data.establishments_pending).toBe(3);

    await request(app)
      .post(`/api/v1/admin/establishments/${oldestPendingId}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(200);

    // Кэш вручную НЕ сбрасываем: это должен был сделать сам сервис записи.
    // Иначе модератор до полминуты видел бы число, которое сам же изменил,
    // и читал бы это как «действие не сработало».
    const after = await request(app)
      .get(BADGES_URL)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data.establishments_pending).toBe(2);

    // Возвращаем фикстуру.
    await query(
      "UPDATE establishments SET status = 'pending' WHERE id = $1",
      [oldestPendingId],
    );
    badgesService.invalidateCache();
  });
});
