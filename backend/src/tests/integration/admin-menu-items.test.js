/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Menu-Item Integration Tests (Smart Search Этап 2, Segment B)
 *
 *   POST /api/v1/admin/menu-items/:id/hide
 *   POST /api/v1/admin/menu-items/:id/unhide
 *   POST /api/v1/admin/menu-items/:id/dismiss-flag
 *   GET  /api/v1/admin/menu-items/flagged
 *
 * Follows the pattern of admin-moderation.test.js:
 *   beforeAll  — create admin
 *   beforeEach — clean menu_items / establishment_media / establishments (CASCADE)
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
} from '../utils/adminTestHelpers.js';

let adminToken;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
});

beforeEach(async () => {
  // menu_items and establishment_media cascade from establishments
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

// Helper: seed a PDF media + menu_items row for an establishment.
// Returns { mediaId, menuItemId }.
async function seedMenuItem(establishmentId, {
  itemName = 'Капучино',
  priceByn = 6.5,
  sanityFlag = null,
  isHiddenByAdmin = false,
  hiddenReason = null,
} = {}) {
  const mediaRes = await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
     RETURNING id`,
    [establishmentId],
  );
  const mediaId = mediaRes.rows[0].id;

  const itemRes = await query(
    `INSERT INTO menu_items
       (establishment_id, media_id, item_name, price_byn, sanity_flag, is_hidden_by_admin, hidden_reason, position)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 0)
     RETURNING id`,
    [
      establishmentId,
      mediaId,
      itemName,
      priceByn,
      sanityFlag ? JSON.stringify(sanityFlag) : null,
      isHiddenByAdmin,
      hiddenReason,
    ],
  );
  return { mediaId, menuItemId: itemRes.rows[0].id };
}

describe('POST /api/v1/admin/menu-items/:id/hide', () => {
  test('hides an item and returns updated row with is_hidden_by_admin=true', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id);

    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Ошибочная цена' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.is_hidden_by_admin).toBe(true);
    expect(res.body.data.hidden_reason).toBe('Ошибочная цена');
  });

  test('returns 400 when reason is missing', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id);

    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('REASON_REQUIRED');
  });

  test('returns 400 when item is already hidden', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id, {
      isHiddenByAdmin: true,
      hiddenReason: 'prior reason',
    });

    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'повтор' })
      .expect(400);

    expect(res.body.error.code).toBe('MENU_ITEM_ALREADY_HIDDEN');
  });

  test('returns 404 for unknown menu item id', async () => {
    const bogus = randomUUID();
    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${bogus}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'x' })
      .expect(404);

    expect(res.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
  });

  // Phase 1 defensive guard (Segment C): partners do not see hidden items in
  // their cabinet, so sending menu_item_hidden_by_admin notification would
  // create a cognitive dead-end. This test prevents accidental restoration
  // of the notification side-effect.
  test('does NOT create menu_item_hidden_by_admin notification (Phase 1)', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id);

    await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Ошибочная цена' })
      .expect(200);

    // Give any accidentally-scheduled fire-and-forget IIFE a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const notifRes = await query(
      `SELECT id FROM notifications
        WHERE user_id = $1 AND type = 'menu_item_hidden_by_admin'`,
      [establishment.partner_id],
    );
    expect(notifRes.rows.length).toBe(0);
  });
});

describe('POST /api/v1/admin/menu-items/:id/unhide', () => {
  test('unhides a hidden item and clears hidden_reason', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id, {
      isHiddenByAdmin: true,
      hiddenReason: 'prior reason',
    });

    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/unhide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.is_hidden_by_admin).toBe(false);
    expect(res.body.data.hidden_reason).toBeNull();
  });

  test('returns 400 when item is not currently hidden', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id);

    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/unhide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error.code).toBe('MENU_ITEM_NOT_HIDDEN');
  });
});

describe('POST /api/v1/admin/menu-items/:id/dismiss-flag', () => {
  test('clears sanity_flag without changing hide state', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id, {
      sanityFlag: { reason: 'price_below_threshold', details: { price: 0.1 } },
    });

    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/dismiss-flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.sanity_flag).toBeNull();
    expect(res.body.data.is_hidden_by_admin).toBe(false);
  });

  test('returns 400 when item has no flag to dismiss', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id);

    const res = await request(app)
      .post(`/api/v1/admin/menu-items/${menuItemId}/dismiss-flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error.code).toBe('MENU_ITEM_NO_FLAG');
  });
});

describe('GET /api/v1/admin/menu-items/flagged', () => {
  test('returns only items with non-null sanity_flag, with establishment context', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    await seedMenuItem(establishment.id, {
      itemName: 'Эспрессо',
      sanityFlag: { reason: 'price_below_threshold', details: { price: 0.05 } },
    });
    await seedMenuItem(establishment.id, {
      itemName: 'Латте',
      priceByn: 8,
      sanityFlag: null, // clean item — should NOT appear
    });

    const res = await request(app)
      .get('/api/v1/admin/menu-items/flagged')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].item_name).toBe('Эспрессо');
    expect(res.body.data[0].establishment_name).toBe(establishment.name);
    expect(res.body.data[0].establishment_city).toBe(establishment.city);
    expect(res.body.meta.total).toBe(1);
  });

  test('filters by sanity_flag.reason query param', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    await seedMenuItem(establishment.id, {
      itemName: 'Низкая цена',
      sanityFlag: { reason: 'price_below_threshold', details: {} },
    });
    await seedMenuItem(establishment.id, {
      itemName: 'Низкая уверенность',
      sanityFlag: { reason: 'low_confidence', details: {} },
    });

    const res = await request(app)
      .get('/api/v1/admin/menu-items/flagged?reason=low_confidence')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].item_name).toBe('Низкая уверенность');
  });
});

describe('Auth + authorization', () => {
  test('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .get('/api/v1/admin/menu-items/flagged')
      .expect(401);

    expect(res.body.success).toBe(false);
  });
});
