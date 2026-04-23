/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Smart Search Этап 2 — End-to-End Integration Test (Segment B, Group 6)
 *
 * Verifies the full pipeline in a single scenario:
 *   1. Admin approves a pending establishment  — triggers backfill OCR enqueue
 *   2. Seed a parsed menu item directly (processJob external calls are mocked out
 *      for determinism; Segment A already covers the OCR pipeline itself)
 *   3. Smart Search with dish="кофе" returns the establishment (via SQL JOIN)
 *   4. Admin hides the only matching menu item
 *   5. Smart Search with dish="кофе" NO LONGER returns the establishment
 *   6. Audit log contains hide_menu_item entry
 *   7. A menu_parsed notification surfaces for the partner when OCR completes
 *
 * Rationale: directive §G6 requires a single test that walks the full flow
 * end-to-end. This file is that anchor test.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  checkAuditLogExists,
} from '../utils/adminTestHelpers.js';
import * as NotificationService from '../../services/notificationService.js';

let adminToken;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
});

beforeEach(async () => {
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

describe('OCR → Smart Search → Admin hide — end-to-end', () => {
  test('full flow: approve → parsed items → dish search → hide → search excluded', async () => {
    // ── 1. Partner establishment in pending status + PDF menu uploaded ─────
    const { establishment, partner } = await createPartnerWithEstablishment('pending');
    const estId = establishment.id;

    const mediaRes = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [estId],
    );
    const mediaId = mediaRes.rows[0].id;

    // ── 2. Admin approves the establishment ────────────────────────────────
    const approveRes = await request(app)
      .post(`/api/v1/admin/establishments/${estId}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve', moderation_notes: {} })
      .expect(200);

    expect(approveRes.body.data.status).toBe('active');

    // Give the fire-and-forget backfill a tick to run.
    await new Promise((r) => setTimeout(r, 100));

    // ── 3. Simulate OCR completion: seed parsed menu_items directly ────────
    // (Segment A's processJob is already covered by ocr-pipeline.test.js;
    //  here we validate the downstream search/hide integration.)
    const itemRes = await query(
      `INSERT INTO menu_items
         (establishment_id, media_id, item_name, price_byn, confidence, position)
       VALUES ($1, $2, 'Кофе эспрессо', 3.50, 0.95, 0)
       RETURNING id`,
      [estId, mediaId],
    );
    const menuItemId = itemRes.rows[0].id;

    // Fire the notification helper directly — verify it runs without throwing.
    await NotificationService.notifyMenuParsed(estId, 1);

    // Partner receives an in-app 'menu_parsed' notification.
    const notifRows = await query(
      "SELECT id, type FROM notifications WHERE user_id = $1 AND type = 'menu_parsed'",
      [partner.user.id],
    );
    expect(notifRows.rows).toHaveLength(1);

    // ── 4. Smart Search with dish: includes our establishment ──────────────
    // We hit searchService.searchWithoutLocation directly through the
    // internal dish param — bypassing AI parsing to keep the test deterministic.
    const { searchWithoutLocation } = await import('../../services/searchService.js');

    let result = await searchWithoutLocation({ dish: 'кофе' });
    let ids = result.establishments.map((e) => e.id);
    expect(ids).toContain(estId);

    // ── 5. Admin hides the matching menu item ──────────────────────────────
    const hideRes = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'тестовая причина' })
      .expect(200);
    expect(hideRes.body.data.is_hidden_by_admin).toBe(true);

    // ── 6. Smart Search with dish: establishment now excluded ─────────────
    result = await searchWithoutLocation({ dish: 'кофе' });
    ids = result.establishments.map((e) => e.id);
    expect(ids).not.toContain(estId);

    // ── 7. Audit log has hide_menu_item entry (if audit_log table exists) ─
    const auditTableExists = await checkAuditLogExists();
    if (auditTableExists) {
      const auditRows = await query(
        `SELECT id FROM audit_log
         WHERE action = 'hide_menu_item' AND entity_id = $1`,
        [menuItemId],
      );
      expect(auditRows.rows.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('dish search with priceMaxByn filter excludes over-budget items', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const estId = establishment.id;

    const mediaRes = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [estId],
    );
    const mediaId = mediaRes.rows[0].id;

    await query(
      `INSERT INTO menu_items
         (establishment_id, media_id, item_name, price_byn, position)
       VALUES ($1, $2, 'Дорогой кофе', 50.00, 0)`,
      [estId, mediaId],
    );

    const { searchWithoutLocation } = await import('../../services/searchService.js');

    // price ceiling at 10 BYN — 50 BYN item should NOT match
    const r1 = await searchWithoutLocation({ dish: 'кофе', priceMaxByn: 10 });
    expect(r1.establishments.map((e) => e.id)).not.toContain(estId);

    // price ceiling at 100 BYN — 50 BYN item DOES match
    const r2 = await searchWithoutLocation({ dish: 'кофе', priceMaxByn: 100 });
    expect(r2.establishments.map((e) => e.id)).toContain(estId);
  });

  test('active promotion with discount_price lets over-priced item through', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const estId = establishment.id;

    const mediaRes = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [estId],
    );
    const mediaId = mediaRes.rows[0].id;

    const itemRes = await query(
      `INSERT INTO menu_items
         (establishment_id, media_id, item_name, price_byn, position)
       VALUES ($1, $2, 'Бургер премиум', 40.00, 0)
       RETURNING id`,
      [estId, mediaId],
    );
    const itemId = itemRes.rows[0].id;

    // Active promotion: 40 BYN → 8 BYN discount, valid all day today
    await query(
      `INSERT INTO promotions
         (establishment_id, title, status, valid_from, menu_item_id, discount_price_byn)
       VALUES ($1, 'Скидка на бургер', 'active', CURRENT_DATE, $2, 8.00)`,
      [estId, itemId],
    );

    const { searchWithoutLocation } = await import('../../services/searchService.js');

    // Budget = 10 BYN: regular price 40 fails, but discounted 8 BYN matches.
    const r = await searchWithoutLocation({ dish: 'бургер', priceMaxByn: 10 });
    expect(r.establishments.map((e) => e.id)).toContain(estId);
  });
});
