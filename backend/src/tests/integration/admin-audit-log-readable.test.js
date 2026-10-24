/**
 * Журнал действий и главная панели читаются человеком (проход по панели
 * модератора, 20.10, пакет П2+П3).
 *
 * - A3-03: у позиции меню есть название и заведение — снимком в old_data на
 *   момент действия и из нынешней строки у записей, сделанных до снимка.
 * - A3-06: запись без автора-человека называет, кто действовал: скрипт
 *   оператора или система (actor_kind), а не «не указан».
 * - A3-30: пауза карточки партнёром пишется в журнал своим кодом.
 * - A3-18, A3-19, A3-20: главная считает приостановки модератора в
 *   решениях, ожидание заявки — от последней правки карточки (решение
 *   Координатора Б), пользователей — без удалённых и отключённых.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
} from '../utils/adminTestHelpers.js';

let admin;

beforeAll(async () => {
  admin = await createAdminAndGetToken();
});

beforeEach(async () => {
  await query('TRUNCATE TABLE audit_log');
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

const asAdmin = (req) => req.set('Authorization', `Bearer ${admin.accessToken}`);

const journal = async () => {
  const res = await asAdmin(request(app).get('/api/v1/admin/audit-log?per_page=100'));
  expect(res.status).toBe(200);
  return res.body.data;
};

async function seedMenuItem(establishmentId, itemName) {
  const media = await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
     RETURNING id`,
    [establishmentId],
  );
  const item = await query(
    `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, position)
     VALUES ($1, $2, $3, 6.5, 0) RETURNING id`,
    [establishmentId, media.rows[0].id, itemName],
  );
  return item.rows[0].id;
}

describe('Журнал: имя позиции меню', () => {
  it('скрытие позиции — название и заведение в записи и в контексте', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    await query('UPDATE establishments SET name = $1, city = $2 WHERE id = $3',
      ['Кофейня у моста', 'Гродно', establishment.id]);
    const itemId = await seedMenuItem(establishment.id, 'Сырники со сметаной');

    const res = await asAdmin(request(app).post(`/api/v1/admin/menu-items/${itemId}/hide`))
      .send({ reason: 'цена ошибочная' });
    expect(res.status).toBe(200);

    const [stored] = (await query(
      "SELECT old_data FROM audit_log WHERE action = 'hide_menu_item'",
    )).rows;
    // Снимок на момент действия и то, что передал писатель, — вместе.
    expect(stored.old_data).toEqual({
      item_name: 'Сырники со сметаной',
      establishment_name: 'Кофейня у моста',
      establishment_city: 'Гродно',
      is_hidden_by_admin: false,
    });

    // Позиция исчезла (повторное распознавание) — имя в журнале осталось.
    await query('DELETE FROM menu_items WHERE id = $1', [itemId]);
    const entry = (await journal()).find((e) => e.action === 'hide_menu_item');
    expect(entry.entity_context).toEqual({
      item_name: 'Сырники со сметаной',
      establishment_name: 'Кофейня у моста',
      establishment_city: 'Гродно',
    });
  });

  it('запись до снимка — имя из нынешней строки, пока позиция жива', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const itemId = await seedMenuItem(establishment.id, 'Латте');
    // Так писались записи до этой правки: без названия.
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
       VALUES ($1, 'unhide_menu_item', 'menu_item', $2, '{"is_hidden_by_admin": true}', '{"is_hidden_by_admin": false}')`,
      [admin.user.id, itemId],
    );

    const entry = (await journal()).find((e) => e.action === 'unhide_menu_item');
    expect(entry.entity_context).toEqual({
      item_name: 'Латте',
      establishment_name: 'Test Establishment',
      establishment_city: 'Минск',
    });
  });
});

describe('Журнал: кто действовал, когда автора-человека нет', () => {
  it('человек, скрипт оператора, система', async () => {
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, new_data, user_agent) VALUES
         ($1, 'suspend', 'establishment', '{"status": "suspended"}', NULL),
         (NULL, 'change_email', 'user', '{"actor": "operator_script:change-account-email"}', 'operator_script:change-account-email'),
         (NULL, 'mark_service_account', 'user', NULL, 'operator_script:mark-service-account'),
         (NULL, 'suspend', 'establishment', '{"status": "suspended", "account_takeover": "google"}', NULL)`,
      [admin.user.id],
    );

    const kinds = (await journal()).map((e) => [e.action, e.actor_kind]).sort();
    expect(kinds).toEqual([
      ['change_email', 'operator_script'],
      ['mark_service_account', 'operator_script'],
      ['suspend', 'person'],
      ['suspend', 'system'],
    ]);
  });
});

describe('Журнал: пауза карточки партнёром', () => {
  it('пауза и возобновление — свои записи от имени партнёра', async () => {
    const { partner, establishment } = await createPartnerWithEstablishment('active');
    const asPartner = (req) => req.set('Authorization', `Bearer ${partner.accessToken}`);

    const paused = await asPartner(request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/suspend`));
    expect(paused.status).toBe(200);
    const resumed = await asPartner(request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/resume`));
    expect(resumed.status).toBe(200);

    const entries = (await journal())
      .map((e) => ({
        action: e.action,
        summary: e.summary,
        kind: e.actor_kind,
        role: e.actor_role,
        name: e.entity_context?.name,
      }))
      .sort((a, b) => a.action.localeCompare(b.action));
    expect(entries).toEqual([
      { action: 'partner_pause', summary: 'Партнёр приостановил заведение', kind: 'person', role: 'partner', name: 'Test Establishment' },
      { action: 'partner_resume', summary: 'Партнёр возобновил заведение', kind: 'person', role: 'partner', name: 'Test Establishment' },
    ]);
  });
});

describe('Главная: числа согласованы с разделами', () => {
  const overview = async () => {
    const res = await asAdmin(request(app).get('/api/v1/admin/analytics/overview?period=30d'));
    expect(res.status).toBe(200);
    return res.body.data;
  };

  it('решения модератора: приостановки в счёте, пауза партнёра и система — нет', async () => {
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type) VALUES
         ($1, 'moderate_approve', 'establishment'),
         ($1, 'suspend', 'establishment'),
         ($1, 'unsuspend', 'establishment'),
         ($1, 'partner_pause', 'establishment'),
         (NULL, 'suspend', 'establishment')`,
      [admin.user.id],
    );

    expect((await overview()).moderation.actions_in_period).toBe(3);
  });

  it('старейшая заявка ждёт от последней правки карточки, как в очереди', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');
    // Черновик пролежал 20 дней, отправлен на модерацию день назад.
    await query(
      `UPDATE establishments
          SET created_at = NOW() - INTERVAL '20 days'
        WHERE id = $1`,
      [establishment.id],
    );
    await query(
      `ALTER TABLE establishments DISABLE TRIGGER update_establishments_updated_at;
       UPDATE establishments SET updated_at = NOW() - INTERVAL '1 day' WHERE id = '${establishment.id}';
       ALTER TABLE establishments ENABLE TRIGGER update_establishments_updated_at;`,
    );

    const oldest = new Date((await overview()).moderation.oldest_pending_at);
    const days = (Date.now() - oldest.getTime()) / 86400000;
    expect(days).toBeGreaterThan(0.9);
    expect(days).toBeLessThan(1.1);
  });

  it('пользователи — без удалённых и отключённых учётных записей', async () => {
    const partnersNow = async () => {
      const res = await asAdmin(request(app).get('/api/v1/admin/analytics/users?period=30d'));
      return res.body.data.role_distribution.find((r) => r.role === 'partner')?.count ?? 0;
    };
    const before = (await overview()).users.total;
    const partnersBefore = await partnersNow();
    const { partner } = await createPartnerWithEstablishment('active');
    expect((await overview()).users.total).toBe(before + 1);
    expect(await partnersNow()).toBe(partnersBefore + 1);

    // Удаление и блокировка выключают учётную запись (is_active = false).
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [partner.user.id]);
    expect((await overview()).users.total).toBe(before);
    expect(await partnersNow()).toBe(partnersBefore);
  });
});
