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
import * as qualityHealthModel from '../../models/qualityHealthModel.js';
import { SANITY_FLAG_REASONS } from '../../services/ocr/sanityChecker.js';

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

// Helper: an establishment with one flagged item, with the venue fields the queue
// actually filters on (city, name) overridable — createPartnerWithEstablishment
// hardcodes «Минск» / «Test Establishment» for every caller.
async function seedFlagged(status, {
  city,
  venueName,
  itemName = 'Капучино',
  reason = 'low_confidence',
  hidden = false,
} = {}) {
  const { establishment } = await createPartnerWithEstablishment(status);

  if (city || venueName) {
    await query(
      `UPDATE establishments
          SET city = COALESCE($1, city), name = COALESCE($2, name)
        WHERE id = $3`,
      [city ?? null, venueName ?? null, establishment.id],
    );
  }

  const seeded = await seedMenuItem(establishment.id, {
    itemName,
    sanityFlag: { reason, details: {} },
    isHiddenByAdmin: hidden,
    hiddenReason: hidden ? 'проверено вручную, цена настоящая' : null,
  });

  return { establishment, ...seeded };
}

const flagged = (queryString = '') => request(app)
  .get(`/api/v1/admin/menu-items/flagged${queryString}`)
  .set('Authorization', `Bearer ${adminToken}`);

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

describe('hide / unhide — one menu uploaded as several files', () => {
  // The guest sees one line for a dish both files hold (public menu-items):
  // hiding one copy would leave the dish on the card from the other file.
  // «Скрыть» and «Вернуть» reach the copies (word of the Coordinator 2026-10-19).
  const insertMedia = async (estId) => (await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
     RETURNING id`,
    [estId],
  )).rows[0].id;
  const insertItem = async (estId, mediaId, itemName, priceByn, { hiddenReason = null, category = null } = {}) => (await query(
    `INSERT INTO menu_items
       (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, hidden_reason, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
     RETURNING id`,
    [estId, mediaId, itemName, priceByn, category, hiddenReason !== null, hiddenReason],
  )).rows[0].id;
  const rowOf = async (id) => (await query('SELECT * FROM menu_items WHERE id = $1', [id])).rows[0];

  test('hiding one copy hides its copies; the guest no longer sees the dish', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const photoId = await insertMedia(establishment.id);
    const pdfId = await insertMedia(establishment.id);
    const photoLatte = await insertItem(establishment.id, photoId, 'Латте', 7);
    await insertItem(establishment.id, photoId, 'Капучино', 6);
    const pdfLatte = await insertItem(establishment.id, pdfId, 'ЛАТТЕ', 7);
    const pdfCappuccino = await insertItem(establishment.id, pdfId, 'Капучино', 6);

    await request(app)
      .post(`/api/v1/admin/menu-items/${photoLatte}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'нет в продаже' })
      .expect(200);

    const copy = await rowOf(pdfLatte);
    expect(copy.is_hidden_by_admin).toBe(true);
    expect(copy.hidden_reason).toBe('нет в продаже');
    expect((await rowOf(pdfCappuccino)).is_hidden_by_admin).toBe(false);

    const audit = await query(
      `SELECT entity_id FROM audit_log WHERE action = 'hide_menu_item' AND entity_id = ANY($1::uuid[])`,
      [[photoLatte, pdfLatte]],
    );
    expect(audit.rows.map(r => r.entity_id).sort()).toEqual([photoLatte, pdfLatte].sort());

    const { slug } = (await query('SELECT slug FROM establishments WHERE id = $1', [establishment.id])).rows[0];
    const guest = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${slug}/menu-items`)
      .expect(200);
    expect(guest.body.data.menu_items.map(i => i.item_name)).toEqual(['Капучино']);
  });

  test('unhiding brings back the copies hidden with it, not a copy hidden for another reason', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const photoId = await insertMedia(establishment.id);
    const pdfId = await insertMedia(establishment.id);
    const boardId = await insertMedia(establishment.id);
    const photoLatte = await insertItem(establishment.id, photoId, 'Латте', 7, { hiddenReason: 'нет в продаже' });
    const pdfLatte = await insertItem(establishment.id, pdfId, 'Латте', 7, { hiddenReason: 'нет в продаже' });
    const boardLatte = await insertItem(establishment.id, boardId, 'Латте', 7, { hiddenReason: 'другая причина' });

    await request(app)
      .post(`/api/v1/admin/menu-items/${photoLatte}/unhide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect((await rowOf(pdfLatte)).is_hidden_by_admin).toBe(false);
    expect((await rowOf(pdfLatte)).hidden_reason).toBeNull();
    expect((await rowOf(boardLatte)).is_hidden_by_admin).toBe(true);
  });

  test('hiding the oysters on the card hides them in the main menu — the same section', async () => {
    // SFB, 2026-10-19: the files share too little to be copies, but the
    // oysters stand under «УСТРИЧНЫЙ БАР» in both — the guest sees one line.
    const { establishment } = await createPartnerWithEstablishment('active');
    const mainId = await insertMedia(establishment.id);
    const cardId = await insertMedia(establishment.id);
    const mainOysters = await insertItem(establishment.id, mainId, 'Плато устриц', 196, { category: 'УСТРИЧНЫЙ БАР' });
    for (const [name, price] of [['Тартар', 25], ['Сибас', 38], ['Паста', 22], ['Тирамису', 14]]) {
      await insertItem(establishment.id, mainId, name, price, { category: 'КУХНЯ' });
    }
    const cardOysters = await insertItem(establishment.id, cardId, 'Плато устриц', 196, { category: 'УСТРИЧНЫЙ БАР' });
    for (const [name, price] of [['Шабли', 30], ['Мюскаде', 26], ['Шампанское', 45], ['Сет устриц', 174]]) {
      await insertItem(establishment.id, cardId, name, price, { category: 'ВИНО' });
    }

    await request(app)
      .post(`/api/v1/admin/menu-items/${cardOysters}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'нет в продаже' })
      .expect(200);

    expect((await rowOf(mainOysters)).is_hidden_by_admin).toBe(true);
  });

  test('a dish of another menu (breakfast vs lunch) stays as it was', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const breakfastId = await insertMedia(establishment.id);
    const lunchId = await insertMedia(establishment.id);
    const breakfastMors = await insertItem(establishment.id, breakfastId, 'Морс', 4);
    for (const [name, price] of [['Каша', 5], ['Омлет', 7], ['Сырники', 8]]) {
      await insertItem(establishment.id, breakfastId, name, price);
    }
    const lunchMors = await insertItem(establishment.id, lunchId, 'Морс', 4);
    for (const [name, price] of [['Борщ', 9], ['Котлета', 12], ['Салат', 6]]) {
      await insertItem(establishment.id, lunchId, name, price);
    }

    await request(app)
      .post(`/api/v1/admin/menu-items/${breakfastMors}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'нет в продаже' })
      .expect(200);

    expect((await rowOf(lunchMors)).is_hidden_by_admin).toBe(false);
  });

  test('copies are the guest\'s: hidden rows do not make two menus copies of one', async () => {
    // Without the hidden rows the files share one line of four — the guest sees
    // two menus and «Морс» in both; hiding one leaves the other.
    const { establishment } = await createPartnerWithEstablishment('active');
    const breakfastId = await insertMedia(establishment.id);
    const lunchId = await insertMedia(establishment.id);
    const breakfastMors = await insertItem(establishment.id, breakfastId, 'Морс', 4);
    for (const [name, price] of [['Каша', 5], ['Омлет', 7], ['Сырники', 8]]) {
      await insertItem(establishment.id, breakfastId, name, price);
    }
    for (const [name, price] of [['Борщ', 9], ['Котлета', 12], ['Салат', 6], ['Суп', 7]]) {
      await insertItem(establishment.id, breakfastId, name, price, { hiddenReason: 'не завтрак' });
    }
    const lunchMors = await insertItem(establishment.id, lunchId, 'Морс', 4);
    for (const [name, price] of [['Борщ', 9], ['Котлета', 12], ['Салат', 6], ['Суп', 7]]) {
      await insertItem(establishment.id, lunchId, name, price);
    }

    await request(app)
      .post(`/api/v1/admin/menu-items/${breakfastMors}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'нет в продаже' })
      .expect(200);

    expect((await rowOf(lunchMors)).is_hidden_by_admin).toBe(false);
  });

  test('a small board sharing the dish with both menus does not join them', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const breakfastId = await insertMedia(establishment.id);
    const lunchId = await insertMedia(establishment.id);
    const boardId = await insertMedia(establishment.id);
    const breakfastMors = await insertItem(establishment.id, breakfastId, 'Морс', 4);
    for (const [name, price] of [['Каша', 5], ['Омлет', 7], ['Сырники', 8]]) {
      await insertItem(establishment.id, breakfastId, name, price);
    }
    const lunchMors = await insertItem(establishment.id, lunchId, 'Морс', 4);
    for (const [name, price] of [['Борщ', 9], ['Котлета', 12], ['Салат', 6], ['Суп', 7]]) {
      await insertItem(establishment.id, lunchId, name, price);
    }
    await insertItem(establishment.id, boardId, 'Морс', 4);
    await insertItem(establishment.id, boardId, 'Лимонад', 5);

    await request(app)
      .post(`/api/v1/admin/menu-items/${breakfastMors}/hide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'нет в продаже' })
      .expect(200);

    expect((await rowOf(lunchMors)).is_hidden_by_admin).toBe(false);
  });
});

describe('dismiss-flag — one menu uploaded as several files', () => {
  // The guest sees one line for a dish both files hold; «Снять флаг» on one
  // copy left the flag on the others, and the same dish stayed in the queue —
  // the button looked broken (walkthrough of the moderator panel, 2026-10-20,
  // A1-07). The flag goes from the copies of the line, as «Скрыть» does.
  const insertMedia = async (estId) => (await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
     RETURNING id`,
    [estId],
  )).rows[0].id;
  const flag = { reason: 'price_above_threshold', details: { price: 900, threshold: 500 } };
  const insertItem = async (estId, mediaId, itemName, priceByn, { flagged = false, hiddenReason = null } = {}) => (await query(
    `INSERT INTO menu_items
       (establishment_id, media_id, item_name, price_byn, sanity_flag, is_hidden_by_admin, hidden_reason, position)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 0)
     RETURNING id`,
    [estId, mediaId, itemName, priceByn, flagged ? JSON.stringify(flag) : null, hiddenReason !== null, hiddenReason],
  )).rows[0].id;
  const flagOf = async (id) => (await query('SELECT sanity_flag FROM menu_items WHERE id = $1', [id])).rows[0].sanity_flag;
  const dismiss = (id) => request(app)
    .post(`/api/v1/admin/menu-items/${id}/dismiss-flag`)
    .set('Authorization', `Bearer ${adminToken}`);

  test('the flag goes from every copy of the line, each with its own audit entry', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const photoId = await insertMedia(establishment.id);
    const pdfId = await insertMedia(establishment.id);
    const photoSteak = await insertItem(establishment.id, photoId, 'Стейк', 900, { flagged: true });
    await insertItem(establishment.id, photoId, 'Салат', 12);
    const pdfSteak = await insertItem(establishment.id, pdfId, 'СТЕЙК', 900, { flagged: true });
    await insertItem(establishment.id, pdfId, 'Салат', 12);

    await dismiss(photoSteak).expect(200);

    expect(await flagOf(photoSteak)).toBeNull();
    expect(await flagOf(pdfSteak)).toBeNull();

    const audit = await query(
      `SELECT entity_id, old_data, new_data FROM audit_log
        WHERE action = 'dismiss_sanity_flag' AND entity_id = ANY($1::uuid[])`,
      [[photoSteak, pdfSteak]],
    );
    expect(audit.rows.map(r => r.entity_id).sort()).toEqual([photoSteak, pdfSteak].sort());
    const copyEntry = audit.rows.find(r => r.entity_id === pdfSteak);
    expect(copyEntry.old_data).toEqual({ sanity_flag: flag });
    expect(copyEntry.new_data).toEqual({ sanity_flag: null, copy_of: photoSteak });

    const queue = await flagged();
    expect(queue.body.data.map(i => i.id)).not.toContain(pdfSteak);
  });

  test('a dish of another menu (breakfast vs lunch) keeps its flag', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const breakfastId = await insertMedia(establishment.id);
    const lunchId = await insertMedia(establishment.id);
    const breakfastMors = await insertItem(establishment.id, breakfastId, 'Морс', 400, { flagged: true });
    for (const [name, price] of [['Каша', 5], ['Омлет', 7], ['Сырники', 8]]) {
      await insertItem(establishment.id, breakfastId, name, price);
    }
    const lunchMors = await insertItem(establishment.id, lunchId, 'Морс', 400, { flagged: true });
    for (const [name, price] of [['Борщ', 9], ['Котлета', 12], ['Салат', 6]]) {
      await insertItem(establishment.id, lunchId, name, price);
    }

    await dismiss(breakfastMors).expect(200);

    expect(await flagOf(breakfastMors)).toBeNull();
    expect(await flagOf(lunchMors)).toEqual(flag);
  });

  test('a hidden row takes the copies hidden with it, not a copy hidden for another reason', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const photoId = await insertMedia(establishment.id);
    const pdfId = await insertMedia(establishment.id);
    const boardId = await insertMedia(establishment.id);
    const photoSteak = await insertItem(establishment.id, photoId, 'Стейк', 900, { flagged: true, hiddenReason: 'нет в продаже' });
    const pdfSteak = await insertItem(establishment.id, pdfId, 'Стейк', 900, { flagged: true, hiddenReason: 'нет в продаже' });
    const boardSteak = await insertItem(establishment.id, boardId, 'Стейк', 900, { flagged: true, hiddenReason: 'другая причина' });

    await dismiss(photoSteak).expect(200);

    expect(await flagOf(pdfSteak)).toBeNull();
    expect(await flagOf(boardSteak)).toEqual(flag);
  });
});

describe('Refusals speak Russian — codes and statuses unchanged', () => {
  // The panel shows the server's text first when it is Russian (admin-web
  // utils/error_text.dart); an English one it drops for a phrase by code.
  // Walkthrough of the moderator panel, 2026-10-20, P1 finding 1.
  const cyrillic = /[А-Яа-яЁё]/;

  test('hide, unhide, dismiss and the queue filters refuse in Russian', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { menuItemId } = await seedMenuItem(establishment.id, {
      isHiddenByAdmin: true,
      hiddenReason: 'проверено',
    });
    const { menuItemId: plain } = await seedMenuItem(establishment.id, { itemName: 'Латте' });
    const post = (path, body = {}) => request(app)
      .post(`/api/v1/admin/menu-items/${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

    const cases = [
      [await post(`${menuItemId}/hide`, { reason: 'повтор' }), 400, 'MENU_ITEM_ALREADY_HIDDEN'],
      [await post(`${plain}/hide`, {}), 400, 'REASON_REQUIRED'],
      [await post(`${plain}/unhide`), 400, 'MENU_ITEM_NOT_HIDDEN'],
      [await post(`${plain}/dismiss-flag`), 400, 'MENU_ITEM_NO_FLAG'],
      [await post(`${randomUUID()}/dismiss-flag`), 404, 'MENU_ITEM_NOT_FOUND'],
      [await flagged('?reason=nonsense'), 400, 'INVALID_SANITY_REASON'],
      [await flagged('?visibility=nonsense'), 400, 'INVALID_VISIBILITY_MODE'],
    ];

    const seen = cases.map(([res]) => ({
      status: res.status,
      code: res.body.error?.code,
      russian: cyrillic.test(res.body.message ?? ''),
    }));
    expect(seen).toEqual(cases.map(([, status, code]) => ({ status, code, russian: true })));
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

  test('skips flagged items on draft, rejected and archived establishments', async () => {
    // OCR is enqueued at CREATION — createEstablishment fires jobs for menu media while
    // the card is still 'draft'. A partner who uploads a menu and walks away therefore
    // leaves flagged items behind permanently. Reviewing those prices changes nothing:
    // nobody can see them and nobody will publish them.
    const inScope = ['active', 'pending', 'suspended'];
    const outOfScope = ['draft', 'rejected', 'archived'];

    for (const status of [...inScope, ...outOfScope]) {
      const { establishment } = await createPartnerWithEstablishment(status);
      await seedMenuItem(establishment.id, {
        itemName: `Блюдо ${status}`,
        sanityFlag: { reason: 'low_confidence', details: {} },
      });
    }

    const res = await request(app)
      .get('/api/v1/admin/menu-items/flagged')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const names = res.body.data.map((i) => i.item_name).sort();
    expect(names).toEqual(inScope.map((s) => `Блюдо ${s}`).sort());
    // meta.total rides a separate COUNT query — a join added to one and not the other
    // would leave the footer claiming more rows than the list can ever show.
    expect(res.body.meta.total).toBe(inScope.length);
  });

  test('list and rail badge agree on the establishment-status axis, and differ only by hidden items',
    async () => {
      // Прежняя версия утверждала равенство `meta.total == hanging_count` и была зелёной
      // по построению: в фикстуре не было НИ ОДНОЙ скрытой флагованной позиции, а
      // собственный комментарий теста это исключение оговаривал. То есть тест не мог
      // упасть ровно на том классе дефекта, ради которого писался.
      //
      // Теперь скрытая позиция есть, и утверждается настоящее соотношение: по статусу
      // заведения обе стороны совпадают, а расходятся ровно на скрытые.
      for (const status of ['active', 'pending', 'suspended', 'draft', 'rejected']) {
        const { establishment } = await createPartnerWithEstablishment(status);
        await seedMenuItem(establishment.id, {
          itemName: `Блюдо ${status}`,
          sanityFlag: { reason: 'price_above_threshold', details: {} },
        });
      }

      // Скрытая позиция с ЖИВЫМ флагом: скрытие не снимает sanity_flag
      // (adminService.hideMenuItem), поэтому такой остаток накапливается навсегда.
      const { establishment: hiddenHost } = await createPartnerWithEstablishment('active');
      await seedMenuItem(hiddenHost.id, {
        itemName: 'Скрытая с флагом',
        sanityFlag: { reason: 'price_above_threshold', details: {} },
        isHiddenByAdmin: true,
        hiddenReason: 'проверено вручную, цена настоящая',
      });

      const res = await request(app)
        .get('/api/v1/admin/menu-items/flagged')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const badge = await qualityHealthModel.getHangingFlags();

      // Бейдж: три статуса в области, скрытая не в счёт.
      expect(badge.hanging_count).toBe(3);
      // Список: те же три статуса, плюс скрытая — её надо видеть, чтобы вернуть.
      expect(res.body.meta.total).toBe(4);

      const hiddenInList = res.body.data.filter((i) => i.is_hidden_by_admin);
      expect(hiddenInList).toHaveLength(1);
      // Расхождение объяснимо ровно скрытыми и ничем больше: убрав их, получаем бейдж.
      expect(res.body.meta.total - hiddenInList.length).toBe(badge.hanging_count);
    });

  // ==========================================================================
  // Фильтр видимости (проход B: закрытие расхождения бейджа и списка)
  // ==========================================================================

  test('visibility=visible делает очередь РАВНОЙ бейджу рейла', async () => {
    // Утверждение сильное намеренно: до этой правки равенство было недостижимо в
    // принципе — скрытие не снимает sanity_flag, и остаток копился навсегда.
    await seedFlagged('active');
    await seedFlagged('pending');
    await seedFlagged('suspended');
    await seedFlagged('active', { hidden: true });
    await seedFlagged('pending', { hidden: true });

    const res = await flagged('?visibility=visible').expect(200);
    const badge = await qualityHealthModel.getHangingFlags();

    expect(res.body.meta.total).toBe(badge.hanging_count);
    expect(res.body.meta.total).toBe(3);
    // Длина проверяется отдельно от `every`: на пустом массиве `every` истинно, и
    // запрос, вернувший ноль строк при total = 3, тест бы пережил.
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.every((i) => i.is_hidden_by_admin === false)).toBe(true);
    // И одновременно экрану есть чем объяснить разницу с «Все».
    expect(res.body.meta.counts).toEqual({ visible: 3, hidden: 2 });
  });

  test('visibility=hidden отдаёт только скрытые', async () => {
    await seedFlagged('active');
    await seedFlagged('active', { hidden: true, itemName: 'Скрытая позиция' });

    const res = await flagged('?visibility=hidden').expect(200);

    expect(res.body.meta.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].item_name).toBe('Скрытая позиция');
    expect(res.body.data[0].is_hidden_by_admin).toBe(true);
  });

  test('без параметра область прежняя — со скрытыми', async () => {
    // Контракт эндпоинта не меняется под теми, кто про параметр не знает.
    await seedFlagged('active');
    await seedFlagged('active', { hidden: true });

    const res = await flagged().expect(200);

    expect(res.body.meta.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
  });

  test('meta.counts не зависит от выбранной видимости', async () => {
    await seedFlagged('active');
    await seedFlagged('active', { hidden: true });
    await seedFlagged('pending', { hidden: true });

    const [all, visible, hidden] = await Promise.all([
      flagged().expect(200),
      flagged('?visibility=visible').expect(200),
      flagged('?visibility=hidden').expect(200),
    ]);

    // Обе половины из одного скана: подпись экрана обязана говорить одно и то же,
    // на какой бы вкладке модератор ни стоял. На «Скрытых» это единственный способ
    // назвать остальную очередь — там total и есть число скрытых.
    const expected = { visible: 1, hidden: 2 };
    expect(all.body.meta.counts).toEqual(expected);
    expect(visible.body.meta.counts).toEqual(expected);
    expect(hidden.body.meta.counts).toEqual(expected);
    // А total у трёх режимов свой.
    expect([all.body.meta.total, visible.body.meta.total, hidden.body.meta.total])
      .toEqual([3, 1, 2]);
  });

  // ==========================================================================
  // Город, поиск, страницы
  // ==========================================================================

  test('фильтр по городу сужает выборку и счётчик', async () => {
    await seedFlagged('active', { city: 'Минск', itemName: 'Минская' });
    await seedFlagged('active', { city: 'Гродно', itemName: 'Гродненская' });
    await seedFlagged('active', { city: 'Гродно', itemName: 'Вторая гродненская' });

    const res = await flagged('?city=Гродно').expect(200);

    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.map((i) => i.establishment_city)).toEqual(['Гродно', 'Гродно']);
  });

  test('meta.cities не сужается выбранным городом, но подчиняется остальным фильтрам',
    async () => {
      // Иначе выбор города схлопывал бы список до единственного пункта — уже
      // выбранного, — и вернуться к «Все города» было бы нечем.
      await seedFlagged('active', { city: 'Минск', reason: 'low_confidence' });
      await seedFlagged('active', { city: 'Гродно', reason: 'low_confidence' });
      await seedFlagged('active', { city: 'Брест', reason: 'price_above_threshold' });

      const withCity = await flagged('?city=Гродно').expect(200);
      expect(withCity.body.meta.cities).toEqual(['Брест', 'Гродно', 'Минск']);

      const withReason = await flagged('?reason=price_above_threshold').expect(200);
      expect(withReason.body.meta.cities).toEqual(['Брест']);
    });

  test('выбранный город остаётся в списке, даже когда его строки отсеяны',
    async () => {
      // Иначе пилюля показала бы «Все города» при активном фильтре: значение,
      // которого нет в списке, интерфейсу нечем отобразить. Ловится ровно так —
      // все минские позиции скрыты, а смотрим на видимые.
      await seedFlagged('active', { city: 'Минск', hidden: true });
      await seedFlagged('active', { city: 'Гродно' });

      const res = await flagged('?visibility=visible&city=Минск').expect(200);

      expect(res.body.meta.total).toBe(0);
      expect(res.body.meta.cities).toContain('Минск');
    });

  test('город с ё и без ё — один фильтр и один пункт списка', async () => {
    // В данных живут оба написания (establishmentService разрешает любое). Точное
    // сравнение раскололо бы очередь надвое: половина под каждым написанием, и
    // счётчик занизил бы её молча.
    await seedFlagged('active', { city: 'Могилев', itemName: 'Без ё' });
    await seedFlagged('active', { city: 'Могилёв', itemName: 'С ё' });

    const withoutYo = await flagged('?city=Могилев').expect(200);
    const withYo = await flagged('?city=Могилёв').expect(200);

    expect(withoutYo.body.meta.total).toBe(2);
    expect(withYo.body.meta.total).toBe(2);
    expect(withoutYo.body.meta.cities).toEqual(['Могилев']);
  });

  test('поиск ловит и название позиции, и название заведения, без учёта регистра',
    async () => {
      await seedFlagged('active', { itemName: 'Драники з мачанкай', venueName: 'Кухмістр' });
      await seedFlagged('active', { itemName: 'Эспрессо', venueName: 'Golden Coffee' });

      const byItem = await flagged('?search=драники').expect(200);
      expect(byItem.body.data.map((i) => i.item_name)).toEqual(['Драники з мачанкай']);

      const byVenue = await flagged('?search=golden').expect(200);
      expect(byVenue.body.data.map((i) => i.item_name)).toEqual(['Эспрессо']);

      // Счётчик обязан считать отфильтрованное, иначе футер обещает страницы,
      // которых нет.
      expect(byVenue.body.meta.total).toBe(1);
      expect(byVenue.body.meta.pages).toBe(1);
    });

  test('порядок очереди определён до последней строки, страницы не пересекаются',
    async () => {
      // Все позиции одной распознанной карты вставляются одной транзакцией и делят
      // метку времени. Без второго ключа сортировки порядок между ними НЕ ОПРЕДЕЛЁН:
      // страница может показать строку дважды, пропустив другую.
      //
      // Проверять это одной лишь несовпадаемостью страниц бесполезно — на трёх строках
      // Postgres и без ключа отдаёт стабильный порядок, и мутация «убрать mi.id DESC»
      // такой тест переживала. Поэтому утверждается сам порядок: при равных метках он
      // обязан быть строго по убыванию id. Совпасть случайно шесть идентификаторов
      // могут с вероятностью 1/720.
      // Одно заведение на шесть позиций — так это и выглядит в жизни (одна
      // распознанная карта), и шесть партнёров с argon2-хэшами ради теста порядка
      // не заводятся.
      const { establishment } = await createPartnerWithEstablishment('active');
      const ids = [];
      for (const itemName of ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая']) {
        const { menuItemId } = await seedMenuItem(establishment.id, {
          itemName,
          sanityFlag: { reason: 'low_confidence', details: {} },
        });
        ids.push(menuItemId);
      }
      await query("UPDATE menu_items SET created_at = TIMESTAMP '2026-08-01 10:00:00'");

      const seen = [];
      for (const page of [1, 2, 3]) {
        const res = await flagged(`?per_page=2&page=${page}`).expect(200);
        expect(res.body.meta.total).toBe(6);
        expect(res.body.meta.pages).toBe(3);
        expect(res.body.data).toHaveLength(2);
        seen.push(...res.body.data.map((i) => i.id));
      }

      // Лексикографическое сравнение канонической записи uuid совпадает с побайтовым,
      // по которому сортирует Postgres: дефисы стоят на одних позициях, а шестнадцате-
      // ричные цифры упорядочены так же, как их значения.
      expect(seen).toEqual([...ids].sort().reverse());
    });

  test('внутри одной карты порядок блюд — как в меню, а не случайный', async () => {
    // При равной метке времени решает `position`: это порядок, в котором блюда
    // прочитаны с карты. Без него очередь показывала бы их вперемешку по uuid.
    const { establishment } = await createPartnerWithEstablishment('active');
    for (const [itemName, position] of [['Третье', 2], ['Первое', 0], ['Второе', 1]]) {
      const { menuItemId } = await seedMenuItem(establishment.id, {
        itemName,
        sanityFlag: { reason: 'low_confidence', details: {} },
      });
      await query('UPDATE menu_items SET position = $1 WHERE id = $2', [position, menuItemId]);
    }
    await query("UPDATE menu_items SET created_at = TIMESTAMP '2026-08-01 10:00:00'");

    const res = await flagged().expect(200);

    expect(res.body.data.map((i) => i.item_name)).toEqual(['Первое', 'Второе', 'Третье']);
  });

  test('фильтры складываются: город + видимость + причина', async () => {
    await seedFlagged('active', { city: 'Минск', reason: 'low_confidence' });
    await seedFlagged('active', {
      city: 'Минск',
      reason: 'low_confidence',
      hidden: true,
    });
    await seedFlagged('active', { city: 'Минск', reason: 'price_above_threshold' });
    await seedFlagged('active', { city: 'Гомель', reason: 'low_confidence' });

    const res = await flagged(
      '?city=Минск&visibility=visible&reason=low_confidence',
    ).expect(200);

    expect(res.body.meta.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].establishment_city).toBe('Минск');
  });

  test('пустые и пробельные значения фильтров не сужают выборку', async () => {
    // `?city=` из очищенного поля не должно превращаться в `city = ''` —
    // пустая выдача читалась бы как «во всех городах чисто».
    //
    // Имена нарочно без пробелов: с «Test Establishment» пробельный поиск
    // находил строку по самому пробелу, и мутация «не обрезать значение»
    // тест переживала.
    await seedFlagged('active', { itemName: 'Драники', venueName: 'Кухмістр' });

    const blank = await flagged('?city=&search=&reason=').expect(200);
    expect(blank.body.meta.total).toBe(1);

    // Пробел — не значение: без обрезки он ушёл бы в SQL как `ILIKE '%  %'`
    // и `city = ' '`, то есть отфильтровал бы всё.
    const spaces = await flagged('?city=%20&search=%20%20').expect(200);
    expect(spaces.body.meta.total).toBe(1);

    // А непустой запрос с полями по краям обязан найти то же, что и без них.
    const padded = await flagged('?search=%20драники%20').expect(200);
    expect(padded.body.data.map((i) => i.item_name)).toEqual(['Драники']);
  });

  test('пустая выборка — это одна пустая страница, а не ноль страниц', async () => {
    // `pages: 0` доезжает до футера как настоящее число: фолбэк клиента срабатывает
    // на null, а не на ноль. Раньше пустой выборкой была только пустая очередь
    // целиком — с серверными фильтрами её даёт любой несовпавший город.
    await seedFlagged('active', { city: 'Минск' });

    const res = await flagged('?city=Гомель').expect(200);

    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.meta.pages).toBe(1);
  });

  test('% и _ в поиске ищутся буквально, а не как шаблон', async () => {
    // Иначе «100%» находит «1000 грамм», а одинокий «%» отдаёт всю очередь под
    // видом результата поиска.
    await seedFlagged('active', { itemName: 'Скидка 100% на кофе' });
    await seedFlagged('active', { itemName: '1000 грамм' });

    const percent = await flagged('?search=100%25').expect(200);
    expect(percent.body.data.map((i) => i.item_name)).toEqual(['Скидка 100% на кофе']);

    // Одинокий «%» — это поиск САМОГО знака процента: находит строку, где он есть,
    // и не находит вторую. Как шаблон он отдал бы обе.
    const wildcardOnly = await flagged('?search=%25').expect(200);
    expect(wildcardOnly.body.data.map((i) => i.item_name)).toEqual(['Скидка 100% на кофе']);

    const underscore = await flagged('?search=_').expect(200);
    expect(underscore.body.meta.total).toBe(0);
  });

  // ==========================================================================
  // Канон причин и отказы
  // ==========================================================================

  test('meta.reasons отдаёт канон причин целиком', async () => {
    await seedFlagged('active');

    const res = await flagged().expect(200);

    expect(res.body.meta.reasons).toEqual([...SANITY_FLAG_REASONS]);
  });

  test('неизвестная причина — 400, а не молчаливая выдача всего', async () => {
    await seedFlagged('active');

    const res = await flagged('?reason=price_outlier').expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_SANITY_REASON');
    // Отказ называет допустимое: клиент строит по нему свой список причин.
    expect(res.body.error.details.allowed).toEqual([...SANITY_FLAG_REASONS]);
  });

  test('неизвестный режим видимости — 400', async () => {
    const res = await flagged('?visibility=invisible').expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_VISIBILITY_MODE');
  });

  test('повторённый параметр — 400, а не молчаливое снятие фильтра', async () => {
    // Express отдаёт `?reason=a&reason=b` массивом. Пропустить его как «значения
    // нет» значило бы вернуть ВСЮ очередь в ответ на запрос по одному правилу —
    // тот же отказ, ради которого стоит проверка на неизвестное значение.
    await seedFlagged('active');

    for (const q of [
      '?reason=low_confidence&reason=price_above_threshold',
      '?city=Минск&city=Гродно',
      '?visibility=all&visibility=hidden',
      '?search=кофе&search=чай',
    ]) {
      const res = await flagged(q).expect(400);
      expect(res.body.error.code).toBe('INVALID_FILTER_VALUE');
    }
  });

  // ==========================================================================
  // Проекция
  // ==========================================================================

  test('проекция несёт категории, кухни и статус заведения', async () => {
    // Категория и кухня нужны брендовой иконке карточки очереди, статус — слову
    // о состоянии заведения; всё трое до этого прохода на клиент не доезжали.
    const { establishment } = await seedFlagged('suspended');

    const res = await flagged().expect(200);
    const row = res.body.data[0];

    expect(row.establishment_categories).toEqual(establishment.categories);
    expect(row.establishment_cuisines).toEqual(establishment.cuisines);
    expect(row.establishment_status).toBe('suspended');
  });

  test('created_at отдаётся как UTC-момент, а не как местное время процесса',
    async () => {
      const { menuItemId } = await seedFlagged('active');
      await query(
        "UPDATE menu_items SET created_at = TIMESTAMP '2026-07-14 09:41:00' WHERE id = $1",
        [menuItemId],
      );

      const res = await flagged().expect(200);

      // Утверждение кусается там, где живёт дефект: на машине с TZ ≠ UTC без каста
      // node-pg прочитает метку как местную и сдвинет её на часовой пояс. В CI с
      // TZ=UTC обе версии дают одно и то же — поэтому проверка мутацией делалась
      // локально (Europe/Minsk).
      expect(new Date(res.body.data[0].created_at).toISOString())
        .toBe('2026-07-14T09:41:00.000Z');
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

describe('GET /api/v1/admin/menu-items/flagged — the menu file of the row (A1-08)', () => {
  test('each row carries its file: link, type, preview, thumbnail', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const { mediaId } = await seedMenuItem(establishment.id, {
      sanityFlag: { reason: 'low_confidence', details: {} },
    });

    const res = await flagged().expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      media_id: mediaId,
      media_url: 'http://test/m.pdf',
      media_file_type: 'pdf',
      media_preview_url: 'http://test/p.png',
      media_thumbnail_url: 'http://test/t.png',
    });
  });
});
