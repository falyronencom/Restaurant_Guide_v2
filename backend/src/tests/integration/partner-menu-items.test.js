/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Partner Menu-Item Integration Tests (Smart Search Этап 2, Segment B)
 *
 *   GET   /api/v1/partner/establishments/:id/menu-items
 *   PATCH /api/v1/partner/menu-items/:id
 *   POST  /api/v1/partner/establishments/:id/retry-ocr
 *
 * Ownership: each partner can only read/modify items belonging to their own
 * establishments. Foreign partners get 404 (not 403, to avoid leaking IDs).
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';

async function createPartner() {
  return createUserAndGetTokens({
    email: `partner-${randomUUID()}@test.com`,
    phone: null,
    password: 'Partner123!@#',
    name: 'Test Partner',
    role: 'partner',
    authMethod: 'email',
  });
}

async function createEstablishmentFor(partnerId) {
  const id = randomUUID();
  await query(
    `INSERT INTO establishments
       (id, partner_id, name, slug, description, city, address, latitude, longitude,
        categories, cuisines, price_range, working_hours, status, created_at, updated_at)
     VALUES ($1, $2, 'Partner Test Estab', gen_random_uuid()::text, 'desc', 'Минск', 'ул. Тестовая 1',
             53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], '$$',
             '{}'::jsonb, 'active', NOW(), NOW())`,
    [id, partnerId],
  );
  return id;
}

async function seedPdfMedia(establishmentId) {
  const res = await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
     RETURNING id`,
    [establishmentId],
  );
  return res.rows[0].id;
}

async function seedPhotoMedia(establishmentId, type) {
  const res = await query(
    `INSERT INTO establishment_media
       (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, $2, 'image', 'http://test/photo.jpg', 'http://test/photo-t.jpg', 'http://test/photo-p.jpg')
     RETURNING id`,
    [establishmentId, type],
  );
  return res.rows[0].id;
}

async function seedMenuItem(establishmentId, mediaId, overrides = {}) {
  const {
    itemName = 'Капучино',
    priceByn = 6.5,
    categoryRaw = null,
    sanityFlag = null,
    isHiddenByAdmin = false,
  } = overrides;
  const res = await query(
    `INSERT INTO menu_items
       (establishment_id, media_id, item_name, price_byn, category_raw, sanity_flag,
        is_hidden_by_admin, position)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0)
     RETURNING *`,
    [
      establishmentId,
      mediaId,
      itemName,
      priceByn,
      categoryRaw,
      sanityFlag ? JSON.stringify(sanityFlag) : null,
      isHiddenByAdmin,
    ],
  );
  return res.rows[0];
}

beforeEach(async () => {
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

describe('GET /api/v1/partner/establishments/:id/menu-items', () => {
  // Phase 1 (Segment C): partner does NOT see admin-hidden items.
  // Platform owns content quality; hidden items are filtered at service layer.
  test('returns only non-hidden items (admin-hidden excluded)', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const mediaId = await seedPdfMedia(estId);

    await seedMenuItem(estId, mediaId, { itemName: 'Кофе' });
    await seedMenuItem(estId, mediaId, {
      itemName: 'Скрытая позиция',
      isHiddenByAdmin: true,
    });

    const res = await request(app)
      .get(`/api/v1/partner/establishments/${estId}/menu-items`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].item_name).toBe('Кофе');
    expect(res.body.data[0].is_hidden_by_admin).toBe(false);
  });

  test('returns 404 when partner does not own the establishment', async () => {
    const p1 = await createPartner();
    const p2 = await createPartner();
    const foreignEst = await createEstablishmentFor(p2.user.id);

    const res = await request(app)
      .get(`/api/v1/partner/establishments/${foreignEst}/menu-items`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .expect(404);

    expect(res.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });
});

describe('PATCH /api/v1/partner/menu-items/:id — one menu uploaded as several files', () => {
  // The guest sees one line for a dish both files hold (public menu-items). An
  // edit of one copy reaches its copies, or the guest would see the old price
  // next to the new one (brief LEAF_BRIEF_MENU_DUPLICATES, finding 1; word of
  // the Coordinator 2026-10-19).
  const seedMenu = async (estId, mediaId, rows) => {
    const seeded = [];
    for (const [itemName, priceByn, overrides = {}] of rows) {
      seeded.push(await seedMenuItem(estId, mediaId, { itemName, priceByn, ...overrides }));
    }
    return seeded;
  };
  const rowOf = async (id) => (await query('SELECT * FROM menu_items WHERE id = $1', [id])).rows[0];
  const guestMenu = async (estId) => {
    const { rows } = await query('SELECT slug FROM establishments WHERE id = $1', [estId]);
    const res = await request(app)
      .get(`/api/v1/public/establishments/by-slug/${rows[0].slug}/menu-items`)
      .expect(200);
    return res.body.data.menu_items.map(i => `${i.item_name} — ${i.price_byn}`);
  };

  test('a new price on one copy reaches the copy in the other file; the guest sees one line', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const photoId = await seedPhotoMedia(estId, 'menu');
    const pdfId = await seedPdfMedia(estId);
    const [photoLatte] = await seedMenu(estId, photoId, [['Латте', 7], ['Капучино', 6]]);
    const [pdfLatte, pdfCappuccino] = await seedMenu(estId, pdfId, [
      ['латте', 7, { sanityFlag: { reason: 'low_confidence', details: {} } }],
      ['Капучино', 6],
    ]);

    await request(app)
      .patch(`/api/v1/partner/menu-items/${photoLatte.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ price_byn: 7.5 })
      .expect(200);

    const copy = await rowOf(pdfLatte.id);
    expect(Number(copy.price_byn)).toBe(7.5);
    expect(copy.sanity_flag).toBeNull();
    expect(Number((await rowOf(pdfCappuccino.id)).price_byn)).toBe(6);
    // Which spelling is shown is the tie between the two files (their ids).
    expect((await guestMenu(estId)).map(l => l.toLowerCase()).sort()).toEqual(['капучино — 6', 'латте — 7.5']);
  });

  test('a dish of another menu (breakfast vs lunch) is not touched', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const breakfastId = await seedPhotoMedia(estId, 'menu');
    const lunchId = await seedPdfMedia(estId);
    const breakfast = { categoryRaw: 'ЗАВТРАК' };
    const lunch = { categoryRaw: 'ОБЕД' };
    const [breakfastMors] = await seedMenu(estId, breakfastId, [
      ['Морс', 4, breakfast], ['Каша', 5, breakfast], ['Омлет', 7, breakfast], ['Сырники', 8, breakfast],
    ]);
    const [lunchMors] = await seedMenu(estId, lunchId, [
      ['Морс', 4, lunch], ['Борщ', 9, lunch], ['Котлета', 12, lunch], ['Салат', 6, lunch],
    ]);

    await request(app)
      .patch(`/api/v1/partner/menu-items/${breakfastMors.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ price_byn: 3.5 })
      .expect(200);

    expect(Number((await rowOf(lunchMors.id)).price_byn)).toBe(4);
  });

  test('a copy the moderator hid is left to the moderator', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const photoId = await seedPhotoMedia(estId, 'menu');
    const pdfId = await seedPdfMedia(estId);
    const [photoLatte] = await seedMenu(estId, photoId, [['Латте', 7]]);
    const [pdfLatte] = await seedMenu(estId, pdfId, [['Латте', 7, { isHiddenByAdmin: true }]]);

    await request(app)
      .patch(`/api/v1/partner/menu-items/${photoLatte.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ price_byn: 7.5 })
      .expect(200);

    expect(Number((await rowOf(pdfLatte.id)).price_byn)).toBe(7);
  });
});

describe('PATCH /api/v1/partner/menu-items/:id', () => {
  test('updates allowed fields and clears sanity_flag', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const mediaId = await seedPdfMedia(estId);
    const item = await seedMenuItem(estId, mediaId, {
      itemName: 'Старое имя',
      priceByn: 3,
      sanityFlag: { reason: 'price_below_threshold', details: {} },
    });

    const res = await request(app)
      .patch(`/api/v1/partner/menu-items/${item.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ item_name: 'Новое имя', price_byn: 7.5 })
      .expect(200);

    expect(res.body.data.item_name).toBe('Новое имя');
    expect(Number(res.body.data.price_byn)).toBe(7.5);
    expect(res.body.data.sanity_flag).toBeNull();
  });

  // «Allowed fields» — each of the three on its own; and each such edit clears
  // the flag: the partner vouches for the item whatever field they touched.
  test.each([
    ['item_name', 'Только имя'],
    ['price_byn', 9.25],
    ['category_raw', 'Супы'],
  ])('an edit of %s alone is stored and clears sanity_flag', async (field, value) => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const mediaId = await seedPdfMedia(estId);
    const item = await seedMenuItem(estId, mediaId, {
      itemName: 'Старое имя',
      priceByn: 3,
      sanityFlag: { reason: 'price_below_threshold', details: {} },
    });

    await request(app)
      .patch(`/api/v1/partner/menu-items/${item.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ [field]: value })
      .expect(200);

    const { rows: [row] } = await query(
      `SELECT ${field} AS value, sanity_flag FROM menu_items WHERE id = $1`,
      [item.id],
    );
    expect(field === 'price_byn' ? Number(row.value) : row.value).toBe(value);
    expect(row.sanity_flag).toBeNull();
  });

  // Until 2026-10-07 the partner could edit a hidden item by its id (200, the
  // item stayed hidden). Since a re-read carries the moderator's «Скрыть» over
  // by the dish name, a renamed hidden item would come back visible after the
  // next «повторить распознавание» — so a hidden item is answered like a
  // stranger's: the partner's list does not show it either.
  test('a dish the moderator hid is not the partner\'s to edit: 404, nothing changes', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const mediaId = await seedPdfMedia(estId);
    const item = await seedMenuItem(estId, mediaId, {
      itemName: 'Кальян',
      isHiddenByAdmin: true,
    });

    const res = await request(app)
      .patch(`/api/v1/partner/menu-items/${item.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ item_name: 'Чай травяной' })
      .expect(404);

    expect(res.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
    const stored = await query('SELECT item_name, is_hidden_by_admin FROM menu_items WHERE id = $1', [item.id]);
    expect(stored.rows[0]).toEqual({ item_name: 'Кальян', is_hidden_by_admin: true });
  });

  test('returns 404 when partner does not own the item', async () => {
    const p1 = await createPartner();
    const p2 = await createPartner();
    const foreignEst = await createEstablishmentFor(p2.user.id);
    const mediaId = await seedPdfMedia(foreignEst);
    const item = await seedMenuItem(foreignEst, mediaId);

    const res = await request(app)
      .patch(`/api/v1/partner/menu-items/${item.id}`)
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .send({ item_name: 'Hack' })
      .expect(404);

    expect(res.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
  });

  test('rejects updates with no editable fields', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const mediaId = await seedPdfMedia(estId);
    const item = await seedMenuItem(estId, mediaId);

    const res = await request(app)
      .patch(`/api/v1/partner/menu-items/${item.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('NO_FIELDS_TO_UPDATE');
  });
});

describe('POST /api/v1/partner/establishments/:id/retry-ocr', () => {
  test('enqueues OCR jobs for all PDF menus', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    await seedPdfMedia(estId);
    await seedPdfMedia(estId);

    const res = await request(app)
      .post(`/api/v1/partner/establishments/${estId}/retry-ocr`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(202);

    expect(res.body.data.totalPdfs).toBe(2);
    expect(res.body.data.enqueuedJobs).toBe(2);

    const jobs = await query(
      'SELECT id FROM ocr_jobs WHERE establishment_id = $1',
      [estId],
    );
    expect(jobs.rows).toHaveLength(2);
  });

  test('enqueues OCR job for menu photo when no PDFs exist (vision_image parity)', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    await seedPhotoMedia(estId, 'menu');

    const res = await request(app)
      .post(`/api/v1/partner/establishments/${estId}/retry-ocr`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(202);

    expect(res.body.data.totalPdfs).toBe(1);
    expect(res.body.data.enqueuedJobs).toBe(1);

    const jobs = await query(
      'SELECT id FROM ocr_jobs WHERE establishment_id = $1',
      [estId],
    );
    expect(jobs.rows).toHaveLength(1);
  });

  // Every photo that is not a menu stays out (establishment_media_type_check:
  // interior, exterior, menu, dishes) — each recognition is paid for, and a
  // dish photo read as a menu would make dishes out of a picture.
  test('mixed media: PDFs and menu photos enqueued, interior, exterior and dish photos excluded', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const pdfId = await seedPdfMedia(estId);
    const menuPhotoId = await seedPhotoMedia(estId, 'menu');
    await seedPhotoMedia(estId, 'interior');
    await seedPhotoMedia(estId, 'exterior');
    await seedPhotoMedia(estId, 'dishes');

    const res = await request(app)
      .post(`/api/v1/partner/establishments/${estId}/retry-ocr`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(202);

    expect(res.body.data.totalPdfs).toBe(2);
    expect(res.body.data.enqueuedJobs).toBe(2);

    const jobs = await query(
      'SELECT media_id FROM ocr_jobs WHERE establishment_id = $1',
      [estId],
    );
    const jobMediaIds = jobs.rows.map((r) => r.media_id).sort();
    expect(jobMediaIds).toEqual([pdfId, menuPhotoId].sort());
  });

  test('returns 400 when establishment has no PDF menus or menu photos', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    // interior photo present — still not OCR-eligible
    await seedPhotoMedia(estId, 'interior');

    const res = await request(app)
      .post(`/api/v1/partner/establishments/${estId}/retry-ocr`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(400);

    expect(res.body.error.code).toBe('NO_PDF_MENUS');
  });
});
