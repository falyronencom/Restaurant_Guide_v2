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
       (id, partner_id, name, description, city, address, latitude, longitude,
        categories, cuisines, price_range, working_hours, status, created_at, updated_at)
     VALUES ($1, $2, 'Partner Test Estab', 'desc', 'Минск', 'ул. Тестовая 1',
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
  test('returns all items including hidden ones', async () => {
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

    expect(res.body.data).toHaveLength(2);
    const names = res.body.data.map((i) => i.item_name).sort();
    expect(names).toEqual(['Кофе', 'Скрытая позиция']);
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

  test('does NOT change is_hidden_by_admin on partner edit', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);
    const mediaId = await seedPdfMedia(estId);
    const item = await seedMenuItem(estId, mediaId, {
      isHiddenByAdmin: true,
    });

    const res = await request(app)
      .patch(`/api/v1/partner/menu-items/${item.id}`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ item_name: 'Обновлено' })
      .expect(200);

    expect(res.body.data.is_hidden_by_admin).toBe(true);
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

  test('returns 400 when establishment has no PDF menus', async () => {
    const partner = await createPartner();
    const estId = await createEstablishmentFor(partner.user.id);

    const res = await request(app)
      .post(`/api/v1/partner/establishments/${estId}/retry-ocr`)
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .expect(400);

    expect(res.body.error.code).toBe('NO_PDF_MENUS');
  });
});
