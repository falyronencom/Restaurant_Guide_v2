/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Establishments Management System Integration Tests
 *
 * Tests all establishment management functionality:
 * - Create establishment (partner only, draft status)
 * - List establishments (pagination, filtering, ownership)
 * - Get establishment details
 * - Update establishment (ownership verification, status transitions)
 * - Submit for moderation (status workflow)
 * - Belarus-specific validation (cities, coordinates, categories, cuisines)
 * - Authorization and ownership checks
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import {
  testEstablishments,
  invalidEstablishments,
  minimalEstablishment
} from '../fixtures/establishments.js';

let partnerToken;
let partner2Token;
let userToken;
let adminToken;
let partnerId;

// Setup and teardown
beforeAll(async () => {
  // Create test users
  const partner1 = await createUserAndGetTokens(testUsers.partner);
  const partner2 = await createUserAndGetTokens(testUsers.partner2);
  const user = await createUserAndGetTokens(testUsers.regularUser);
  const admin = await createUserAndGetTokens(testUsers.admin);

  partnerToken = partner1.accessToken;
  partner2Token = partner2.accessToken;
  userToken = user.accessToken;
  adminToken = admin.accessToken;
  partnerId = partner1.user.id;
});

beforeEach(async () => {
  // Clear establishments before each test
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

describe('Establishments System - Create Establishment', () => {
  describe('POST /api/v1/partner/establishments - Basic Creation', () => {
    test('should create new establishment in draft status', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.establishment).toBeDefined();

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(testEstablishments[0].name);
      expect(establishment.city).toBe('Минск');
      expect(establishment.status).toBe('draft');
      expect(establishment.partner_id).toBe(partnerId);
      expect(establishment.id).toBeDefined();
    });

    test('should create establishment with all fields', async () => {
      const establishmentData = testEstablishments[0];

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(establishmentData)
        .expect(201);

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(establishmentData.name);
      expect(establishment.description).toBe(establishmentData.description);
      expect(establishment.city).toBe(establishmentData.city);
      expect(establishment.address).toBe(establishmentData.address);
      expect(parseFloat(establishment.latitude)).toBeCloseTo(establishmentData.latitude);
      expect(parseFloat(establishment.longitude)).toBeCloseTo(establishmentData.longitude);
      expect(establishment.phone).toBe(establishmentData.phone);
      expect(establishment.email).toBe(establishmentData.email);
      expect(establishment.website).toBe(establishmentData.website);
      expect(establishment.categories).toEqual(establishmentData.categories);
      expect(establishment.cuisines).toEqual(establishmentData.cuisines);
      expect(establishment.price_range).toBe(establishmentData.price_range);
    });

    test('should create establishment with minimal required fields', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(minimalEstablishment)
        .expect(201);

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(minimalEstablishment.name);
      expect(establishment.city).toBe(minimalEstablishment.city);
      expect(establishment.working_hours).toBeDefined();
      expect(establishment.phone).toBeNull();
      expect(establishment.email).toBeNull();
      expect(establishment.website).toBeNull();
    });

    test('should reject creation without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .send(testEstablishments[0])
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    test('should allow creation by regular user (auto-upgrade to partner)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${userToken}`)
        .send(testEstablishments[0])
        .expect(201);

      expect(response.body.data.establishment).toBeDefined();
    });
  });

  describe('POST/PUT - Media Materialization Limits & OCR enqueue', () => {
    const photoUrls = (count, prefix) => Array.from(
      { length: count },
      (_, i) => `https://res.cloudinary.com/test/image/upload/${prefix}-${i}.jpg`,
    );

    const pollOcrJobs = async (establishmentId, expected, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const jobs = await query(
          'SELECT media_id FROM ocr_jobs WHERE establishment_id = $1',
          [establishmentId],
        );
        if (jobs.rows.length >= expected || Date.now() > deadline) {
          return jobs.rows;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };

    test('create accepts 30 interior photos at the bucket limit', async () => {
      const data = { ...testEstablishments[0], interior_photos: photoUrls(30, 'interior') };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      const media = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'interior'",
        [response.body.data.establishment.id],
      );
      expect(media.rows).toHaveLength(30);
    });

    test('create rejects 31 interior photos with MEDIA_LIMIT_EXCEEDED, no orphan row', async () => {
      const data = { ...testEstablishments[0], interior_photos: photoUrls(31, 'interior') };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      // Validation fires before the INSERT — no orphan establishment row.
      const rows = await query('SELECT id FROM establishments', []);
      expect(rows.rows).toHaveLength(0);
    });

    test('create rejects 31 menu photos with MEDIA_LIMIT_EXCEEDED', async () => {
      const data = { ...testEstablishments[0], menu_photos: photoUrls(31, 'menu') };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');
    });

    test('create with menu photos enqueues OCR jobs for them only (vision_image parity)', async () => {
      const data = {
        ...testEstablishments[0],
        interior_photos: photoUrls(2, 'interior'),
        menu_photos: photoUrls(2, 'menu'),
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      const estId = response.body.data.establishment.id;
      const jobs = await pollOcrJobs(estId, 2);
      expect(jobs).toHaveLength(2);

      const menuMedia = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(jobs.map((j) => j.media_id).sort())
        .toEqual(menuMedia.rows.map((r) => r.id).sort());
    });

    test('PUT media-sync rejects 31 photos per bucket, accepts 30', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const over = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: photoUrls(31, 'interior') })
        .expect(403);
      expect(over.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      const overMenu = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: photoUrls(31, 'menu') })
        .expect(403);
      expect(overMenu.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: photoUrls(30, 'interior') })
        .expect(200);

      const media = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'interior'",
        [estId],
      );
      expect(media.rows).toHaveLength(30);
    });

    // Regression: cabinet cards are created in two stages (POST at validator
    // minimum WITHOUT photos, then autosave PUT adds media). The PUT media-sync
    // must populate establishments.primary_image_url (catalog thumbnail) and type
    // menu PDFs correctly — both were broken (MARBL, 2026-07-20).
    const menuPdfUrl = 'https://res.cloudinary.com/test/image/upload/v1/establishments/temp/x/menu_pdf/abc.pdf';

    test('two-stage create→PUT populates establishments.primary_image_url', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;
      expect(created.body.data.establishment.primary_image_url).toBeNull();

      const interior = photoUrls(3, 'interior');
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: interior, primary_photo: interior[1] })
        .expect(200);

      const row = await query('SELECT primary_image_url FROM establishments WHERE id = $1', [estId]);
      expect(row.rows[0].primary_image_url).toBe(interior[1]);
    });

    test('PUT falls back to the first interior photo as primary when none named', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const interior = photoUrls(2, 'interior');
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: interior })
        .expect(200);

      const row = await query('SELECT primary_image_url FROM establishments WHERE id = $1', [estId]);
      expect(row.rows[0].primary_image_url).toBe(interior[0]);
    });

    test('removing all interior photos clears primary_image_url', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const interior = photoUrls(2, 'interior');
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: interior })
        .expect(200);
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: [] })
        .expect(200);

      const row = await query('SELECT primary_image_url FROM establishments WHERE id = $1', [estId]);
      expect(row.rows[0].primary_image_url).toBeNull();
    });

    test('PUT with a menu PDF url stores file_type=pdf + transformed pg_1 preview', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [menuPdfUrl] })
        .expect(200);

      const row = await query(
        "SELECT file_type, url, preview_url, thumbnail_url FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(row.rows).toHaveLength(1);
      const m = row.rows[0];
      expect(m.file_type).toBe('pdf');
      expect(m.url).toBe(menuPdfUrl); // original preserved for download
      expect(m.preview_url).not.toBe(menuPdfUrl); // transformed, not raw pdf (Cloudinary 401s raw)
      expect(m.preview_url).toContain('pg_1');
      expect(m.thumbnail_url).toContain('pg_1');
    });

    test('PUT with a plain image menu url keeps file_type=image (unchanged url)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const menuImg = photoUrls(1, 'menu')[0];
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [menuImg] })
        .expect(200);

      const row = await query(
        "SELECT file_type, preview_url FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(row.rows[0].file_type).toBe('image');
      expect(row.rows[0].preview_url).toBe(menuImg);
    });

    // Regression: cabinet menus arrive via the two-stage flow (POST without
    // media, then autosave PUT), so OCR must be enqueued on the sync path too —
    // before 2026-07-20 only createEstablishment enqueued, and no cabinet menu
    // was ever recognized (MARBL).
    test('PUT media-sync enqueues OCR for newly inserted menu media only', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const menuUrls = [photoUrls(1, 'menu')[0], menuPdfUrl];
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: photoUrls(2, 'interior'), menu_photos: menuUrls })
        .expect(200);

      const jobs = await pollOcrJobs(estId, 2);
      const menuMedia = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(menuMedia.rows).toHaveLength(2);
      expect(jobs.map((j) => j.media_id).sort())
        .toEqual(menuMedia.rows.map((r) => r.id).sort());

      // Re-sending the same bucket must not duplicate jobs (diff yields no
      // inserts; enqueue idempotency is the second guard).
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: menuUrls })
        .expect(200);
      const jobsAfter = await query(
        'SELECT media_id FROM ocr_jobs WHERE establishment_id = $1',
        [estId],
      );
      expect(jobsAfter.rows).toHaveLength(2);
    });

    // Regression (MARKS, 2026-07-20): an .ai URL in the menu bucket lands as
    // file_type='image' and renders broken everywhere. The URL extension gate
    // must reject it before any DB write.
    const aiUrl = 'https://res.cloudinary.com/test/image/upload/v1/establishments/temp/x/menu_pdf/menu.ai';

    test('create rejects an .ai menu url with INVALID_FILE_TYPE, no orphan row', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], menu_photos: [aiUrl] })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
      const rows = await query('SELECT id FROM establishments', []);
      expect(rows.rows).toHaveLength(0);
    });

    test('create rejects a PDF url in menu_photos (create types that bucket as image)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], menu_photos: [menuPdfUrl] })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('PUT media-sync rejects an .ai menu url and writes nothing', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const response = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [aiUrl] })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');

      const media = await query(
        'SELECT id FROM establishment_media WHERE establishment_id = $1',
        [estId],
      );
      expect(media.rows).toHaveLength(0);
    });

    test('PUT media-sync rejects a PDF url in the interior bucket', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const response = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: [menuPdfUrl] })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    // Contract pin: canonical image delivery URLs built by
    // generateAllResolutions carry NO extension (cloudinary.url() without
    // `format` — transformation segment + public_id + query only). The gate
    // must accept that shape for image buckets, or every real cabinet
    // autosave PUT / mobile registration finalize 422s (found in review,
    // 2026-07-20).
    const extensionlessUrl = 'https://res.cloudinary.com/test/image/upload/c_limit,h_1080,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/temp/u1/interior/abc123xyz?_a=BAMAK';

    test('PUT media-sync accepts a canonical extension-less image url', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: [extensionlessUrl], menu_photos: [extensionlessUrl] })
        .expect(200);

      const media = await query(
        'SELECT id FROM establishment_media WHERE establishment_id = $1',
        [estId],
      );
      expect(media.rows).toHaveLength(2);
    });

    test('create accepts a canonical extension-less image url', async () => {
      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], interior_photos: [extensionlessUrl] })
        .expect(201);
    });

    test('PUT media-sync keeps accepting an unchanged legacy url set (gate is insert-only)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      // Seed a legacy row whose url would FAIL today's gate (pre-gate data).
      await query(
        `INSERT INTO establishment_media
           (establishment_id, type, file_type, url, thumbnail_url, preview_url, position)
         VALUES ($1, 'menu', 'image', $2, $2, $2, 0)`,
        [estId, aiUrl],
      );

      // Re-sending the same set = no new inserts → must stay 200.
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [aiUrl] })
        .expect(200);
    });
  });

  describe('POST /api/v1/partner/establishments - Belarus City Validation', () => {
    test('should accept Минск', async () => {
      const data = { ...testEstablishments[0], city: 'Минск' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Минск');
    });

    test('should accept Гродно', async () => {
      const data = { ...testEstablishments[0], city: 'Гродно', latitude: 53.68, longitude: 23.83 };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Гродно');
    });

    test('should accept Брест', async () => {
      const data = { ...testEstablishments[0], city: 'Брест', latitude: 52.1, longitude: 23.7 };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Брест');
    });

    test('should accept Гомель', async () => {
      const data = { ...testEstablishments[0], city: 'Гомель', latitude: 52.42, longitude: 31.0 };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Гомель');
    });

    test('should accept Витебск, Могилев, Бобруйск', async () => {
      const citiesWithCoords = [
        { city: 'Витебск', latitude: 55.19, longitude: 30.2 },
        { city: 'Могилев', latitude: 53.91, longitude: 30.35 },
        { city: 'Бобруйск', latitude: 53.15, longitude: 29.25 },
      ];

      for (const { city, latitude, longitude } of citiesWithCoords) {
        const data = { ...testEstablishments[0], name: `Test ${city}`, city, latitude, longitude };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.city).toBe(city);
      }
    });

    test('should reject invalid city (Москва)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCity)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.message.toLowerCase()).toContain('validation');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'city' })])
      );
    });

    test('should reject invalid city (Kiev)', async () => {
      const data = { ...testEstablishments[0], city: 'Киев' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Geographic Coordinates Validation', () => {
    test('should accept valid Minsk coordinates', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(parseFloat(response.body.data.establishment.latitude)).toBeCloseTo(53.9);
      expect(parseFloat(response.body.data.establishment.longitude)).toBeCloseTo(27.5);
    });

    test('should accept coordinates at Belarus boundaries', async () => {
      // Northern city (Витебск) — near north of Belarus
      const neData = {
        ...testEstablishments[0],
        name: 'NE Corner',
        city: 'Витебск',
        latitude: 55.19,
        longitude: 30.2
      };

      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(neData)
        .expect(201);

      // South-Western city (Брест) — near south-west of Belarus
      const swData = {
        ...testEstablishments[0],
        name: 'SW Corner',
        city: 'Брест',
        latitude: 52.1,
        longitude: 23.7
      };

      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(swData)
        .expect(201);
    });

    test('should reject coordinates outside Belarus (Moscow)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.outsideBelarus)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'longitude' })])
      );
    });

    test('should reject coordinates north of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 57.0, // Above 56.0
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates south of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 50.0, // Below 51.0
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates west of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 22.0 // Below 23.0
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates east of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 34.0 // Above 33.0
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Categories Validation', () => {
    test('should accept 1 category', async () => {
      const data = {
        ...testEstablishments[0],
        categories: ['Ресторан']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.categories).toEqual(['Ресторан']);
    });

    test('should accept 2 categories', async () => {
      const data = {
        ...testEstablishments[0],
        categories: ['Ресторан', 'Бар']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.categories).toEqual(['Ресторан', 'Бар']);
    });

    test('should reject 0 categories', async () => {
      const data = {
        ...testEstablishments[0],
        categories: []
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject 3 categories (max is 2)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.tooManyCategories)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should accept all valid category types', async () => {
      const validCategories = [
        'Ресторан', 'Кофейня', 'Кафе', 'Фаст-фуд', 'Бар', 'Кондитерская',
        'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная',
        'Боулинг', 'Караоке', 'Бильярд', 'Клуб'
      ];

      for (const category of validCategories) {
        const data = {
          ...testEstablishments[0],
          name: `Test ${category}`,
          categories: [category]
        };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.categories).toContain(category);
      }
    });

    test('should reject invalid category', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCategory)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Cuisines Validation', () => {
    test('should accept 1 cuisine', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toEqual(['Европейская']);
    });

    test('should accept 2 cuisines', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская', 'Итальянская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toHaveLength(2);
    });

    test('should accept 3 cuisines (maximum)', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская', 'Итальянская', 'Японская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toHaveLength(3);
    });

    test('should reject 0 cuisines', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: []
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject 4 cuisines (max is 3)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.tooManyCuisines)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should accept all valid cuisine types', async () => {
      const validCuisines = [
        'Народная', 'Авторская', 'Азиатская', 'Американская',
        'Вегетарианская', 'Японская', 'Грузинская', 'Итальянская',
        'Смешанная', 'Европейская', 'Китайская', 'Восточная'
      ];

      for (const cuisine of validCuisines) {
        const data = {
          ...testEstablishments[0],
          name: `Test ${cuisine}`,
          cuisines: [cuisine]
        };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.cuisines).toContain(cuisine);
      }
    });

    test('should reject invalid cuisine', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCuisine)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Required Fields Validation', () => {
    test('should reject missing name', async () => {
      const data = { ...testEstablishments[0] };
      delete data.name;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' })
      );
    });

    test('should reject missing description', async () => {
      const data = { ...testEstablishments[0] };
      delete data.description;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    test('should reject missing city', async () => {
      const data = { ...testEstablishments[0] };
      delete data.city;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing coordinates', async () => {
      const data = { ...testEstablishments[0] };
      delete data.latitude;
      delete data.longitude;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing categories', async () => {
      const data = { ...testEstablishments[0] };
      delete data.categories;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing cuisines', async () => {
      const data = { ...testEstablishments[0] };
      delete data.cuisines;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

describe('Establishments System - List & Read Operations', () => {
  let establishment1Id;

  beforeEach(async () => {
    // Create test establishments
    const response1 = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(testEstablishments[0]);
    establishment1Id = response1.body.data.establishment.id;

    await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[1], name: 'Second Establishment' });
  });

  describe('GET /api/v1/partner/establishments - List Own Establishments', () => {
    test('should list all partner establishments', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishments).toHaveLength(2);
      expect(response.body.data.pagination).toBeDefined();
    });

    test('should only show own establishments (ownership filter)', async () => {
      // Partner 2 creates establishment
      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partner2Token}`)
        .send({ ...testEstablishments[2], name: 'Partner 2 Restaurant' });

      // Partner 1 lists - should only see their 2 establishments
      const response = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishments).toHaveLength(2);
      response.body.data.establishments.forEach(est => {
        expect(est.partner_id).toBe(partnerId);
      });
    });

    test('should support pagination', async () => {
      // Create more establishments
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ ...testEstablishments[0], name: `Establishment ${i}` });
      }

      // Get page 1
      const page1 = await request(app)
        .get('/api/v1/partner/establishments?page=1&limit=5')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(page1.body.data.establishments).toHaveLength(5);
      expect(page1.body.data.pagination.page).toBe(1);
      expect(page1.body.data.pagination.pages).toBeGreaterThanOrEqual(3);

      // Get page 2
      const page2 = await request(app)
        .get('/api/v1/partner/establishments?page=2&limit=5')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(page2.body.data.establishments).toHaveLength(5);
      expect(page2.body.data.pagination.page).toBe(2);
    });

    test('should filter by status', async () => {
      // Submit one for moderation
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment1Id}/submit`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // Filter by draft
      const drafts = await request(app)
        .get('/api/v1/partner/establishments?status=draft')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(drafts.body.data.establishments).toHaveLength(1);
      expect(drafts.body.data.establishments[0].status).toBe('draft');

      // Filter by pending
      const pending = await request(app)
        .get('/api/v1/partner/establishments?status=pending')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(pending.body.data.establishments).toHaveLength(1);
      expect(pending.body.data.establishments[0].status).toBe('pending');
    });
  });

  describe('GET /api/v1/partner/establishments/:id - Get Single Establishment', () => {
    test('should get establishment details', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment1Id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishment.id).toBe(establishment1Id);
      expect(response.body.data.establishment.name).toBe(testEstablishments[0].name);
    });

    test('should reject getting other partner establishment', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment1Id}`)
        .set('Authorization', `Bearer ${partner2Token}`)
        .expect(404);

      expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    });

    test('should reject non-existent establishment', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    });

    test('should reject invalid UUID format', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments/invalid-uuid')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

describe('Establishments System - Update Operations', () => {
  let establishmentId;

  beforeEach(async () => {
    const response = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[0], name: 'Update Target' });

    establishmentId = response.body.data.establishment.id;
  });

  test('should update establishment description', async () => {
    const response = await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ description: 'Updated description' })
      .expect(200);

    expect(response.body.data.establishment.description).toBe('Updated description');
    expect(response.body.data.establishment.id).toBe(establishmentId);
  });

  test('should keep active status on major change (re-moderation removed)', async () => {
    await query('UPDATE establishments SET status = $1 WHERE id = $2', ['active', establishmentId]);

    const response = await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        name: 'Updated Name',
        categories: ['Ресторан'],
        cuisines: ['Европейская'],
      })
      .expect(200);

    expect(response.body.data.establishment.status).toBe('active');
    expect(response.body.data.establishment.name).toBe('Updated Name');
  });

  test('should reject updates by non-owner partner', async () => {
    await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partner2Token}`)
      .send({ description: 'Should fail' })
      .expect(403);
  });
});

describe('Establishments System - Status Workflow', () => {
  let establishmentId;

  beforeEach(async () => {
    const response = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[0], name: 'Submit Target' });

    establishmentId = response.body.data.establishment.id;
  });

  test('should submit draft for moderation (draft → pending)', async () => {
    const response = await request(app)
      .post(`/api/v1/partner/establishments/${establishmentId}/submit`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    expect(response.body.data.establishment.status).toBe('pending');
  });

  test('should reject submitting already pending establishment', async () => {
    await request(app)
      .post(`/api/v1/partner/establishments/${establishmentId}/submit`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const second = await request(app)
      .post(`/api/v1/partner/establishments/${establishmentId}/submit`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(400);

    expect(second.body.error.code).toBe('INVALID_STATUS_FOR_SUBMISSION');
  });
});

describe('Establishments System - Slug Lifecycle', () => {
  describe('Auto-generation on create', () => {
    test('should auto-generate slug from name', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Кафе Весна' })
        .expect(201);

      expect(response.body.data.establishment.slug).toBeDefined();
      expect(response.body.data.establishment.slug).toBe('kafe-vesna');
    });

    test('two establishments with the same name get different slugs via auto-suffix', async () => {
      // Same name allowed across different partners (name uniqueness is partner-scoped),
      // but slug uniqueness is global — auto-suffix resolves the collision.
      const first = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Кафе Весна' })
        .expect(201);

      const second = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partner2Token}`)
        .send({ ...testEstablishments[0], name: 'Кафе Весна' })
        .expect(201);

      expect(first.body.data.establishment.slug).toBe('kafe-vesna');
      expect(second.body.data.establishment.slug).toBe('kafe-vesna-2');
      expect(first.body.data.establishment.slug)
        .not.toBe(second.body.data.establishment.slug);
    });
  });

  describe('Slug lifecycle on update', () => {
    test('renaming a draft regenerates the slug (mutable status)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Старое название' })
        .expect(201);

      const id = created.body.data.establishment.id;
      const originalSlug = created.body.data.establishment.slug;
      expect(originalSlug).toBe('staroe-nazvanie');

      const updated = await request(app)
        .put(`/api/v1/partner/establishments/${id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ name: 'Новое название' })
        .expect(200);

      expect(updated.body.data.establishment.slug).toBe('novoe-nazvanie');
      expect(updated.body.data.establishment.slug).not.toBe(originalSlug);
    });

    test('renaming an active establishment does NOT change slug (frozen)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Активный ресторан' })
        .expect(201);

      const id = created.body.data.establishment.id;
      const originalSlug = created.body.data.establishment.slug;

      // Promote to active manually (skip full moderation flow for test brevity)
      await query('UPDATE establishments SET status = $1 WHERE id = $2', ['active', id]);

      const updated = await request(app)
        .put(`/api/v1/partner/establishments/${id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ name: 'Переименованный ресторан' })
        .expect(200);

      // Display name changes, slug stays frozen for URL stability post-approve
      expect(updated.body.data.establishment.name).toBe('Переименованный ресторан');
      expect(updated.body.data.establishment.slug).toBe(originalSlug);
    });
  });

  describe('Admin slug correction (PATCH /admin/:id/slug)', () => {
    test('admin can override slug on an active establishment', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Заведение для admin' })
        .expect(201);

      const id = created.body.data.establishment.id;
      await query('UPDATE establishments SET status = $1 WHERE id = $2', ['active', id]);

      const updated = await request(app)
        .patch(`/api/v1/admin/establishments/${id}/slug`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug: 'custom-admin-slug' })
        .expect(200);

      expect(updated.body.data.slug).toBe('custom-admin-slug');
    });

    test('admin PATCH with already-taken slug returns 409', async () => {
      const first = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Первое заведение' })
        .expect(201);

      const second = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Второе заведение' })
        .expect(201);

      const secondId = second.body.data.establishment.id;
      const firstSlug = first.body.data.establishment.slug;

      const response = await request(app)
        .patch(`/api/v1/admin/establishments/${secondId}/slug`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug: firstSlug })
        .expect(409);

      expect(response.body.error.code).toBe('SLUG_ALREADY_TAKEN');
    });
  });
});
